const express=require('express'),db=require('../db');
const {authenticate}=require('../middleware/auth');
const {profileVisibleSql}=require('../profileVisibility');
const router=express.Router();router.use(authenticate);
const unmatched=`NOT EXISTS(SELECT 1 FROM matches m WHERE (m.user1_id=l.sender_id AND m.user2_id=l.receiver_id) OR (m.user1_id=l.receiver_id AND m.user2_id=l.sender_id))`;
const receivedWhere=`l.receiver_id=$1 AND l.receiver_dismissed_at IS NULL AND ${profileVisibleSql('l.sender_id','$1')}`;
router.get('/count',async(req,res)=>{
 try{const result=await db.query(`SELECT count(*)::int AS count FROM likes l JOIN auras a ON a.user_id=l.sender_id WHERE ${receivedWhere} AND ${unmatched}`,[req.user.userId]);res.set('Cache-Control','no-store').json(result.rows[0]);}
 catch{res.status(503).json({error:'Unable to load received Auras.'});}
});
router.get('/',async(req,res)=>{
 const direction=req.query.direction||'received';
 if(!['received','sent'].includes(direction))return res.status(400).json({error:'Choose received or sent Auras.'});
 const sent=direction==='sent',other=sent?'l.receiver_id':'l.sender_id';
 try{
  const result=await db.query(`SELECT l.id,${other} AS user_id,l.created_at,l.opener,a.aura_name,a.aura_color,a.bio,a.vibe,a.dating_intention,
    u.age,u.gender,u.city,
    (SELECT m.id FROM matches m WHERE (m.user1_id=l.sender_id AND m.user2_id=l.receiver_id) OR (m.user1_id=l.receiver_id AND m.user2_id=l.sender_id) ORDER BY m.id LIMIT 1) AS match_id,
    EXISTS(SELECT 1 FROM matches m WHERE ((m.user1_id=l.sender_id AND m.user2_id=l.receiver_id) OR (m.user1_id=l.receiver_id AND m.user2_id=l.sender_id)) AND m.soul_game_completed) AS can_chat
    FROM likes l JOIN users u ON u.id=${other} JOIN auras a ON a.user_id=u.id
    WHERE ${sent?`l.sender_id=$1 AND ${profileVisibleSql(other,'$1')}`:`${receivedWhere} AND (${unmatched} OR l.opener IS NOT NULL)`}
    ORDER BY l.created_at DESC,l.id DESC LIMIT 100`,[req.user.userId]);
  res.set('Cache-Control','no-store').json(result.rows);
 }catch{res.status(500).json({error:'Unable to load Discover Auras.'});}
});
router.post('/:id/pass',async(req,res)=>{
 const id=Number(req.params.id);
 if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:'Invalid Aura.'});
 try{
  const result=await db.query('UPDATE likes SET receiver_dismissed_at=COALESCE(receiver_dismissed_at,NOW()) WHERE id=$1 AND receiver_id=$2 RETURNING id',[id,req.user.userId]);
  if(!result.rowCount)return res.status(404).json({error:'Aura not found.'});
  res.json({ok:true});
 }catch{res.status(500).json({error:'Unable to pass on this Aura.'});}
});
module.exports=router;
