const { profileVisibleSql } = require('./profileVisibility');
const db = require('./db');
// Connections are people with an existing mutual match. Blocks take precedence.
function visiblePostSql(alias = 'p', viewer = '$1') {
  return `(${alias}.user_id = ${viewer} OR (
    NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=${viewer} AND b.blocked_id=${alias}.user_id) OR (b.blocked_id=${viewer} AND b.blocker_id=${alias}.user_id))
    AND ${profileVisibleSql(`${alias}.user_id`,viewer)}
    AND (${alias}.visibility='public' OR (${alias}.visibility='connections' AND EXISTS (
      SELECT 1 FROM matches m WHERE (m.user1_id=${viewer} AND m.user2_id=${alias}.user_id) OR (m.user2_id=${viewer} AND m.user1_id=${alias}.user_id)
    )))
  ))`;
}
async function canViewPost(postId, userId) {
  const result = await db.query(`SELECT p.id FROM posts p WHERE p.id=$1 AND ${visiblePostSql('p','$2')}`, [postId,userId]);
  return result.rowCount > 0;
}
module.exports = { visiblePostSql, canViewPost };
