const db=require('./db');
exports.removeMessage=async(req,res)=>{
 const {action}=req.body;
 if(!['unsend','delete_for_me'].includes(action))return res.status(400).json({error:'Invalid action.'});
 const client=await db.pool.connect();
 try{
  await client.query('BEGIN');
  const result=await client.query(`SELECT msg.*,clock_timestamp() AS server_now FROM messages msg JOIN matches m ON m.id=msg.match_id
   WHERE msg.id=$1 AND m.id=$2 AND (m.user1_id=$3 OR m.user2_id=$3)
   AND NOT EXISTS(SELECT 1 FROM conversation_preferences cp WHERE cp.user_id=$3 AND cp.match_id=m.id AND msg.created_at<=cp.deleted_at)
   AND NOT EXISTS(SELECT 1 FROM hidden_messages h WHERE h.message_id=msg.id AND h.user_id=$3) FOR UPDATE OF msg`,[Number(req.params.messageId),Number(req.params.matchId),req.user.userId]);
  if(!result.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Message unavailable.'});}
  const msg=result.rows[0];
  if(action==='delete_for_me')await client.query('INSERT INTO hidden_messages(message_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[msg.id,req.user.userId]);
  else{
   if(msg.sender_id!==req.user.userId){await client.query('ROLLBACK');return res.status(403).json({error:'Only the sender can unsend.'});}
   const deadline=Math.min(new Date(msg.created_at).getTime()+600000,msg.read_at?new Date(msg.read_at).getTime()+300000:Infinity);
   if(msg.unsent_at||new Date(msg.server_now).getTime()>=deadline){await client.query('ROLLBACK');return res.status(409).json({error:'The unsend window has ended.'});}
   await client.query("UPDATE messages SET unsent_at=clock_timestamp(),content='',attachment=NULL,attachment_mime=NULL,duration_seconds=NULL,kind='text' WHERE id=$1",[msg.id]);
   await client.query('DELETE FROM message_reactions WHERE message_id=$1',[msg.id]);
  }
  await client.query('COMMIT');
  if(action==='unsend')req.app.get('io')?.to(`match:${Number(req.params.matchId)}`).emit('message:unsent',{messageId:msg.id});
  res.json({ok:true});
 }catch(error){await client.query('ROLLBACK');console.error(error);res.status(500).json({error:'Unable to remove message.'});}finally{client.release();}
};
