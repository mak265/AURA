const db=require('./db');
function presenceFieldsSql(alias='u',viewer='$1') {
  const hidden=`(${alias}.settings->>'hide_online')='true' OR EXISTS(SELECT 1 FROM blocks presence_block WHERE (presence_block.blocker_id=${viewer} AND presence_block.blocked_id=${alias}.id) OR (presence_block.blocked_id=${viewer} AND presence_block.blocker_id=${alias}.id))`;
  return `CASE WHEN ${hidden} THEN NULL ELSE EXISTS(SELECT 1 FROM user_presence presence_tab WHERE presence_tab.user_id=${alias}.id AND presence_tab.expires_at>NOW()) END AS active_now,
    CASE WHEN ${hidden} OR (${alias}.settings->>'hide_last_active')='true' THEN NULL ELSE ${alias}.last_active_at END AS last_active_at`;
}
async function presenceHeartbeat(req,res) {
  const {sessionId,active}=req.body||{};
  if(typeof sessionId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)||typeof active!=='boolean')return res.status(400).json({error:'Invalid presence update.'});
  let client;
  try{
    client=await db.pool.connect();
    await client.query('BEGIN');
    await client.query(`INSERT INTO user_presence(user_id,session_id,expires_at) VALUES($1,$2,CASE WHEN $3 THEN NOW()+INTERVAL '60 seconds' ELSE NOW() END)
      ON CONFLICT(user_id,session_id) DO UPDATE SET expires_at=EXCLUDED.expires_at`,[req.user.userId,sessionId,active]);
    await client.query('UPDATE users SET last_active_at=NOW() WHERE id=$1',[req.user.userId]);
    await client.query("DELETE FROM user_presence WHERE user_id=$1 AND expires_at<NOW()-INTERVAL '1 day'",[req.user.userId]);
    await client.query('COMMIT');res.json({ok:true});
  }catch(error){if(client)await client.query('ROLLBACK');console.error(error);res.status(500).json({error:'Unable to update activity.'});}
  finally{client?.release();}
}
module.exports={presenceFieldsSql,presenceHeartbeat};
