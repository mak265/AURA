const db=require('./db');
async function manageConversation(req,res) {
  const action=req.body?.action;
  const updates={pin:['pinned',true],unpin:['pinned',false],archive:['archived',true],unarchive:['archived',false],mute:['muted',true],unmute:['muted',false],high_risk:['high_risk',true],clear_risk:['high_risk',false]};
  if(typeof action!=='string'||(!Object.hasOwn(updates,action)&&!['block','unblock','delete'].includes(action)))return res.status(400).json({error:'Choose a valid conversation action.'});
  let client;
  try{
    client=await db.pool.connect();await client.query('BEGIN');
    const result=await client.query('SELECT * FROM matches WHERE id=$1 AND (user1_id=$2 OR user2_id=$2) FOR UPDATE',[Number(req.params.matchId),req.user.userId]);
    if(!result.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Conversation not found.'});}
    const match=result.rows[0],other=match.user1_id===req.user.userId?match.user2_id:match.user1_id;
    await client.query('INSERT INTO conversation_preferences(user_id,match_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.user.userId,match.id]);
    if(updates[action])await client.query(`UPDATE conversation_preferences SET ${updates[action][0]}=$3 WHERE user_id=$1 AND match_id=$2`,[req.user.userId,match.id,updates[action][1]]);
    if(action==='delete')await client.query('UPDATE conversation_preferences SET deleted_at=NOW(),pinned=FALSE,archived=FALSE WHERE user_id=$1 AND match_id=$2',[req.user.userId,match.id]);
    if(action==='block'){
      await client.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.user.userId,other]);
      await client.query("UPDATE aura_sessions SET status='ended' WHERE status='active' AND ((user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1))",[req.user.userId,other]);
    }
    if(action==='unblock')await client.query('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2',[req.user.userId,other]);
    await client.query('COMMIT');res.json({ok:true,action});
  }catch(error){if(client)await client.query('ROLLBACK');console.error(error);res.status(500).json({error:'Unable to update conversation.'});}
  finally{client?.release();}
}
module.exports={manageConversation};
