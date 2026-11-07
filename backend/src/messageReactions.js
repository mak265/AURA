const db = require('./db');
const allowed = new Set(['like','love','care','haha','wow','sad','angry']);
exports.reactToMessage = async (req,res) => {
  const {reaction}=req.body;
  if(!allowed.has(reaction))return res.status(400).json({error:'Choose a valid reaction.'});
  const client=await db.pool.connect();
  try{
    await client.query('BEGIN');
    const result=await client.query(`SELECT msg.id FROM messages msg JOIN matches m ON m.id=msg.match_id
      WHERE msg.id=$1 AND m.id=$2 AND (m.user1_id=$3 OR m.user2_id=$3) AND m.soul_game_completed AND msg.unsent_at IS NULL AND NOT EXISTS(SELECT 1 FROM hidden_messages h WHERE h.message_id=msg.id AND h.user_id=$3)
      AND NOT EXISTS(SELECT 1 FROM conversation_preferences cp WHERE cp.user_id=$3 AND cp.match_id=m.id AND msg.created_at<=cp.deleted_at)
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=m.user1_id AND b.blocked_id=m.user2_id) OR (b.blocker_id=m.user2_id AND b.blocked_id=m.user1_id))
      FOR UPDATE OF msg`,[Number(req.params.messageId),Number(req.params.matchId),req.user.userId]);
    if(!result.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Message unavailable.'});}
    const old=await client.query('SELECT reaction FROM message_reactions WHERE message_id=$1 AND user_id=$2',[req.params.messageId,req.user.userId]);
    if(old.rows[0]?.reaction===reaction)await client.query('DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2',[req.params.messageId,req.user.userId]);
    else await client.query('INSERT INTO message_reactions(message_id,user_id,reaction) VALUES($1,$2,$3) ON CONFLICT(message_id,user_id) DO UPDATE SET reaction=EXCLUDED.reaction',[req.params.messageId,req.user.userId,reaction]);
    const reactions=(await client.query('SELECT user_id,reaction FROM message_reactions WHERE message_id=$1 ORDER BY user_id',[req.params.messageId])).rows;
    await client.query('COMMIT');
    req.app.get('io')?.to(`match:${Number(req.params.matchId)}`).emit('message:reactions',{messageId:Number(req.params.messageId),reactions});
    res.json({messageId:Number(req.params.messageId),reactions});
  }catch(error){await client.query('ROLLBACK');console.error(error);res.status(500).json({error:'Unable to react.'});}
  finally{client.release();}
};
