const db = require('./db');

const RECENT_LOGIN_SECONDS = 15 * 60;

async function deleteOwnAccount(req, res) {
  if (req.body?.confirmation !== 'DELETE') {
    return res.status(400).json({ error: 'Type DELETE to confirm account deletion.' });
  }
  if (req.user.role !== 'user') {
    return res.status(403).json({ error: 'Management accounts must be handled through the management team.' });
  }
  const age = Math.floor(Date.now() / 1000) - req.user.iat;
  if (!Number.isInteger(age) || age < 0 || age > RECENT_LOGIN_SECONDS) {
    return res.status(403).json({ code: 'RECENT_LOGIN_REQUIRED', error: 'Sign in again before deleting your account.' });
  }
  try {
    const result = await db.query(
      "DELETE FROM users WHERE id = $1 AND auth_version = $2 AND management_role = 'user' RETURNING id",
      [req.user.userId, req.user.version || 0]
    );
    if (!result.rowCount) return res.status(409).json({ error: 'Account changed. Sign in again to continue.' });
  } catch (error) {
    console.error('Account deletion failed:', error.code || error.name);
    return res.status(500).json({ error: 'Unable to delete the account right now.' });
  }
  res.json({ deleted: true });
  try {
    req.app.get('io')?.in(`alerts:${req.user.userId}`).disconnectSockets(true);
  } catch (error) {
    console.error('Deleted account socket cleanup failed:', error.code || error.name);
  }
}

module.exports = { deleteOwnAccount };
