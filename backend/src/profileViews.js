const db = require('./db');
const { profileVisibleSql } = require('./profileVisibility');

function visibleViewsSql(owner) {
  return `FROM profile_views v
    JOIN auras a ON a.user_id = v.viewer_id
    WHERE v.owner_id = ${owner}
      AND ${profileVisibleSql('v.viewer_id', owner)}
      AND ${profileVisibleSql(owner, 'v.viewer_id')}`;
}

async function countProfileViewers(ownerId) {
  const { rows: [result] } = await db.query(
    `SELECT COUNT(*)::int AS total ${visibleViewsSql('$1')}`, [ownerId]
  );
  return result.total;
}

async function recordProfileView(ownerId, viewerId) {
  const result = await db.query(`
    INSERT INTO profile_views (owner_id, viewer_id)
    SELECT u.id, $2 FROM users u
    WHERE u.id = $1 AND u.id <> $2
      AND EXISTS (SELECT 1 FROM auras WHERE user_id = u.id)
      AND ${profileVisibleSql('u.id', '$2')}
    ON CONFLICT (owner_id, viewer_id) DO UPDATE SET viewed_at = NOW()
  `, [ownerId, viewerId]);
  return result.rowCount > 0;
}

async function listProfileViews(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const { rows: [result] } = await db.query(`
      SELECT COALESCE(owner.premium_until > NOW(), FALSE) AS premium,
        CASE WHEN owner.premium_until > NOW() THEN (
          SELECT COALESCE(json_agg(recent ORDER BY recent.viewed_at DESC, recent.id), '[]'::json)
          FROM (
            SELECT v.viewer_id AS id, a.aura_name, v.viewed_at
            ${visibleViewsSql('owner.id')}
            ORDER BY v.viewed_at DESC, v.viewer_id
            LIMIT 50
          ) recent
        ) END AS viewers
      FROM users owner WHERE owner.id = $1
    `, [req.user.userId]);
    if (!result?.premium) {
      return res.status(403).json({ code: 'PREMIUM_REQUIRED', error: 'Profile viewers are available with Premium.' });
    }
    res.json({ viewers: result.viewers });
  } catch (error) {
    console.error('Profile viewers error:', error);
    res.status(500).json({ error: 'Unable to load profile viewers.' });
  }
}

module.exports = { recordProfileView, listProfileViews, countProfileViewers };
