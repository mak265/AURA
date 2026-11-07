const db = require('./db');
function profileVisibleSql(owner, viewer) {
  return `(${owner}=${viewer} OR (
    NOT EXISTS(SELECT 1 FROM blocks pb WHERE (pb.blocker_id=${owner} AND pb.blocked_id=${viewer}) OR (pb.blocked_id=${owner} AND pb.blocker_id=${viewer}))
    AND (EXISTS(SELECT 1 FROM users pu WHERE pu.id=${owner} AND (pu.settings->>'private_dating') IS DISTINCT FROM 'true')
      OR EXISTS(SELECT 1 FROM likes pl WHERE pl.sender_id=${owner} AND pl.receiver_id=${viewer})
      OR EXISTS(SELECT 1 FROM aura_requests pr WHERE pr.sender_id=${owner} AND pr.receiver_id=${viewer} AND pr.status IN ('pending','accepted'))
      OR EXISTS(SELECT 1 FROM matches pm WHERE (pm.user1_id=${owner} AND pm.user2_id=${viewer}) OR (pm.user2_id=${owner} AND pm.user1_id=${viewer})))
  ))`;
}
async function canSeeProfile(owner, viewer) {
  const result = await db.query(`SELECT ${profileVisibleSql('$1::integer','$2::integer')} AS allowed`, [owner,viewer]);
  return result.rows[0]?.allowed === true;
}
module.exports = { profileVisibleSql, canSeeProfile };
