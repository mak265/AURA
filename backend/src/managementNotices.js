const express = require('express');
const db = require('./db');
const { authenticate } = require('./middleware/auth');
const { notifyActivity } = require('./messageAlerts');
const { sendNativePush } = require('./nativePush');

const router = express.Router();
router.use(authenticate, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/', async (req, res) => {
  const userId = req.user.userId;
  const summary = req.query.summary === '1';
  const before = req.query.before === undefined ? null : Number(req.query.before);
  if (before !== null && (!Number.isInteger(before) || before < 1 || before > 2147483647)) {
    return res.status(400).json({ error: 'Invalid notice page.' });
  }
  try {
    const { rows } = await db.query(`
      SELECT id, action, reason, effective_until, read_at, created_at
      FROM management_notices WHERE user_id = $1 AND ($2::int IS NULL OR id < $2)
      ORDER BY id DESC LIMIT $3
    `, [userId, before, summary ? 1 : 51]);
    if (!summary) {
      const notices = rows.slice(0, 50);
      const { rows: cases } = await db.query(`
        SELECT target_id, id, status, updated_at
        FROM safety_reports
        WHERE reporter_id = $1 AND kind = 'appeal' AND target_id = ANY($2::int[])
        ORDER BY id DESC
      `, [userId, notices.map(notice => notice.id)]);
      return res.json({
        notices: notices.map(notice => ({
          ...notice,
          appeals: cases.filter(appeal => appeal.target_id === notice.id),
        })),
        hasMore: rows.length > 50,
      });
    }
    const { rows: [state] } = await db.query(
      'SELECT EXISTS (SELECT 1 FROM management_notices WHERE user_id = $1 AND read_at IS NULL) AS unread', [userId]
    );
    res.json({ latest: rows[0] || null, unread: state.unread });
  } catch (error) {
    console.error('Management inbox lookup failed:', error.code || error.name);
    res.status(500).json({ error: 'Unable to load AURA Management messages.' });
  }
});

router.post('/read', async (req, res) => {
  const id = req.body?.throughId;
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ error: 'Invalid notice.' });
  try {
    await db.query(`
      UPDATE management_notices SET read_at = NOW() WHERE user_id = $1 AND id <= $2 AND read_at IS NULL
        AND EXISTS (SELECT 1 FROM management_notices latest WHERE latest.id = $2 AND latest.user_id = $1)
    `, [req.user.userId, id]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Management inbox update failed:', error.code || error.name);
    res.status(500).json({ error: 'Unable to mark notices as read.' });
  }
});

async function recordManagementNotice(client, userId, action, reason, effectiveUntil = null) {
  await client.query(
    'INSERT INTO management_notices (user_id, action, reason, effective_until) VALUES ($1, $2, $3, $4)',
    [userId, action, reason, effectiveUntil]
  );
}

function alertManagementNotice(io, userId, previousAuthVersion) {
  const body = 'You have a new message from AURA Management.';
  const path = '/matches/management';
  const delivery = previousAuthVersion === undefined
    ? notifyActivity(io, userId, null, { path, body })
    : sendNativePush(userId, previousAuthVersion, path, body);
  delivery.catch(error => console.error('Management notice alert failed:', error.code || error.name));
}

async function bannedAccountResponse(res, userId) {
  const { rows: [notice] } = await db.query(
    "SELECT reason FROM management_notices WHERE user_id = $1 AND action = 'ban' ORDER BY id DESC LIMIT 1", [userId]
  );
  return res.status(403).json({
    code: 'ACCOUNT_BANNED',
    error: notice?.reason
      ? `AURA Management suspended your account. Reason: ${notice.reason} If you believe this was a mistake, contact AURA support to request a review.`
      : 'This account has been banned. If you believe this was a mistake, contact AURA support to request a review.'
  });
}

module.exports = { router, recordManagementNotice, alertManagementNotice, bannedAccountResponse };
