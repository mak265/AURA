const express = require('express');
const { randomBytes } = require('node:crypto');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { superOnly, audit, safeError } = require('../management');

const adminCodes = express.Router();
adminCodes.use(superOnly, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

async function transaction(work) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const normalizeCode = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
const validCode = code => /^[A-Z0-9][A-Z0-9-]{5,39}$/.test(code);
const inRange = (value, max) => Number.isInteger(value) && value >= 1 && value <= max;

adminCodes.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Math.min(Number.parseInt(req.query.page, 10) || 1, 100000));
    const { rows } = await db.query('SELECT * FROM premium_codes ORDER BY id DESC LIMIT 26 OFFSET $1', [(page - 1) * 25]);
    res.json({ codes: rows.slice(0, 25), hasMore: rows.length > 25 });
  } catch (error) {
    safeError(res, error);
  }
});

adminCodes.post('/', async (req, res) => {
  const { days, maxClaims, claimWindowDays = null, label = '', code: customCode = '' } = req.body || {};
  const code = normalizeCode(customCode);
  if (!inRange(days, 365) || !inRange(maxClaims, 100000) ||
      (claimWindowDays !== null && !inRange(claimWindowDays, 365)) ||
      typeof label !== 'string' || label.length > 80 ||
      typeof customCode !== 'string' || (code && !validCode(code))) {
    return res.status(400).json({ error: 'Use 1–365 days, 1–100,000 claims, and an optional code of 6–40 letters, numbers or hyphens.' });
  }
  try {
    const created = await transaction(async client => {
      const { rows: [row] } = await client.query(`
        INSERT INTO premium_codes (code, label, premium_days, max_claims, expires_at)
        VALUES ($1, $2, $3, $4, NOW() + $5::int * INTERVAL '24 hours')
        RETURNING *
      `, [code || 'AURA-' + randomBytes(8).toString('hex').toUpperCase(), label.trim(), days, maxClaims, claimWindowDays]);
      await audit(client, req.actor, 'premium_code_created', 'premium_code', row.id, 'Premium giveaway', {
        label: row.label, days, maxClaims, expires_at: row.expires_at
      });
      return row;
    });
    res.status(201).json(created);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That code already exists.' });
    safeError(res, error);
  }
});

adminCodes.post('/:id/revoke', async (req, res) => {
  const id = Number(req.params.id);
  if (!inRange(id, 2147483647)) return res.status(404).json({ error: 'Code not found.' });
  try {
    const revoked = await transaction(async client => {
      const result = await client.query(
        'UPDATE premium_codes SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING id', [id]
      );
      if (result.rowCount) await audit(client, req.actor, 'premium_code_revoked', 'premium_code', id, 'Stopped future claims');
      return result.rowCount > 0;
    });
    if (!revoked) return res.status(404).json({ error: 'Code is missing or already revoked.' });
    res.json({ ok: true });
  } catch (error) {
    safeError(res, error);
  }
});

const redeemCode = [authenticate, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const code = normalizeCode(req.body?.code);
  if (!validCode(code)) return res.status(400).json({ error: 'Enter a valid Premium code.' });
  const userId = req.user.userId;
  try {
    const result = await transaction(async client => {
      const { rows: [offer] } = await client.query(`
        SELECT *, expires_at <= clock_timestamp() AS expired FROM premium_codes WHERE code = $1 FOR UPDATE
      `, [code]);
      if (!offer) return { status: 404, error: 'Code not found.' };
      const claimed = await client.query('SELECT 1 FROM premium_code_claims WHERE code_id = $1 AND user_id = $2', [offer.id, userId]);
      if (claimed.rowCount) return { status: 409, error: 'You’ve already redeemed this code.' };
      if (offer.revoked_at || offer.expired) return { status: 410, error: 'This code is no longer available.' };
      if (offer.claimed_count >= offer.max_claims) return { status: 409, error: 'All claims for this code have been used.' };

      await client.query('INSERT INTO premium_code_claims (code_id, user_id) VALUES ($1, $2)', [offer.id, userId]);
      const { rows: [user] } = await client.query(`
        UPDATE users SET premium_until = GREATEST(NOW(), premium_until) + $2::int * INTERVAL '24 hours'
        WHERE id = $1 RETURNING premium_until
      `, [userId, offer.premium_days]);
      await client.query('UPDATE premium_codes SET claimed_count = claimed_count + 1 WHERE id = $1', [offer.id]);
      return { days: offer.premium_days, premium_until: user.premium_until };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (error) {
    console.error('Premium code redemption failed:', error.code || error.name);
    res.status(500).json({ error: 'Unable to redeem this code right now.' });
  }
}];

module.exports = { adminCodes, redeemCode };
