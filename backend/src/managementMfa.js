const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const db = require('./db');
const { authLimit } = require('./authLimits');

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const audience = 'aura-management-mfa';
const key = () => crypto.createHmac('sha256', process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET)
  .update('aura-totp-encryption-v1').digest();
const fingerprint = token => crypto.createHash('sha256').update(token).digest('base64url');

function issueManagementToken(loginToken) {
  return jwt.sign({ session: fingerprint(loginToken) }, process.env.JWT_SECRET, { audience, expiresIn: '1h' });
}

function isManagementVerified(req) {
  try {
    const token = jwt.verify(req.get('X-Aura-Management'), process.env.JWT_SECRET, { audience, algorithms: ['HS256'] });
    return token.session === fingerprint(req.get('Authorization').slice(7));
  } catch { return false; }
}

function encodeSecret(bytes) {
  let value = 0, bits = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}

function encrypt(secret, userId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(String(userId)));
  const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function decrypt(payload, userId) {
  const bytes = Buffer.from(payload, 'base64url');
  const cipher = crypto.createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(String(userId)));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
}

function totp(secret, counter) {
  const step = Buffer.alloc(8);
  step.writeBigUInt64BE(BigInt(counter));
  const hash = crypto.createHmac('sha1', secret).update(step).digest();
  const offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.actor.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin access required.' });
  next();
});

const limitMfa = scope => authLimit(scope, req => [[`ip:${req.ip}`, 40], [`user:${req.actor.id}`, 8]]);

router.post('/setup', limitMfa('mfa-setup'), async (req, res) => {
  const password = req.body?.password;
  if (typeof password !== 'string' || !password || password.length > 128) {
    return res.status(400).json({ error: 'Enter your current password.' });
  }
  try {
    const userId = req.actor.id;
    const { rows: [user] } = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.status(403).json({ error: 'Current password is incorrect.' });
    }
    const secret = crypto.randomBytes(20);
    const result = await db.query(`
      INSERT INTO management_mfa (user_id, encrypted_secret, pending_until)
      VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
      ON CONFLICT (user_id) DO UPDATE SET
        encrypted_secret = EXCLUDED.encrypted_secret, pending_until = EXCLUDED.pending_until
      WHERE management_mfa.enabled_at IS NULL
      RETURNING user_id
    `, [userId, encrypt(secret, userId)]);
    if (!result.rowCount) return res.status(409).json({ error: 'An authenticator is already enrolled.' });
    res.json({ secret: encodeSecret(secret) });
  } catch (error) {
    console.error('MFA setup failed:', error.code || error.name);
    res.status(500).json({ error: 'Unable to set up the authenticator.' });
  }
});

router.post('/verify', limitMfa('mfa-verify'), async (req, res) => {
  const code = req.body?.code;
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the six-digit code.' });
  try {
    const userId = req.actor.id;
    const { rows: [record] } = await db.query(`
      SELECT encrypted_secret FROM management_mfa
      WHERE user_id = $1 AND (enabled_at IS NOT NULL OR pending_until > NOW())
    `, [userId]);
    if (!record) return res.status(409).json({ code: 'MFA_SETUP_REQUIRED', error: 'Set up your authenticator first.' });
    const secret = decrypt(record.encrypted_secret, userId);
    const now = Math.floor(Date.now() / 30000);
    const counter = [now, now - 1, now + 1].find(step =>
      crypto.timingSafeEqual(Buffer.from(totp(secret, step)), Buffer.from(code))
    );
    if (counter === undefined) return res.status(403).json({ error: 'Invalid code. Check your authenticator and try again.' });
    const result = await db.query(`
      UPDATE management_mfa SET enabled_at = COALESCE(enabled_at, NOW()), last_counter = $2
      WHERE user_id = $1 AND encrypted_secret = $3 AND (enabled_at IS NOT NULL OR pending_until > NOW())
        AND (last_counter IS NULL OR last_counter < $2)
      RETURNING user_id
    `, [userId, counter, record.encrypted_secret]);
    if (!result.rowCount) return res.status(403).json({ error: 'This code is no longer valid. Wait for the next one.' });
    res.json({ token: issueManagementToken(req.get('Authorization').slice(7)) });
  } catch (error) {
    console.error('MFA verification failed:', error.code || error.name);
    res.status(500).json({ error: 'Unable to verify your code.' });
  }
});

module.exports = { router, isManagementVerified, issueManagementToken };
