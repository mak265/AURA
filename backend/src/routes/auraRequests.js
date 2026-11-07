const { enforceText } = require('../textModeration');
const { profileVisibleSql } = require('../profileVisibility');
const express=require('express');
const db=require('../db');
const {authenticate}=require('../middleware/auth');
const {canViewPost}=require('../postPrivacy');
const router=express.Router();router.use(authenticate);
const matchSql=`SELECT id,soul_game_completed FROM matches WHERE (user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1) ORDER BY id LIMIT 1`;
router.get('/',async(req,res)=>{
  const direction=req.query.direction || 'received';
  if(!['received','sent'].includes(direction))return res.status(400).json({error:'Choose received or sent requests.'});
  const sent=direction==='sent';
  try{
    const result=await db.query(`SELECT r.id,r.sender_id,r.receiver_id,r.opening_message,r.status,r.match_id,r.created_at,
      CASE WHEN ${profileVisibleSql(sent?'r.receiver_id':'r.sender_id','$1')} THEN a.aura_name ELSE 'Private member' END AS aura_name,
      CASE WHEN ${profileVisibleSql(sent?'r.receiver_id':'r.sender_id','$1')} THEN a.emoji ELSE NULL END AS emoji,
      CASE WHEN ${profileVisibleSql(sent?'r.receiver_id':'r.sender_id','$1')} THEN a.bio ELSE NULL END AS bio FROM aura_requests r LEFT JOIN auras a ON a.user_id=${sent?'r.receiver_id':'r.sender_id'}
      WHERE ${sent?'r.sender_id':'r.receiver_id'}=$1 ${sent?'':"AND r.status='pending'"} AND NOT EXISTS(SELECT 1 FROM blocks b
        WHERE (b.blocker_id=$1 AND b.blocked_id=${sent?'r.receiver_id':'r.sender_id'}) OR (b.blocked_id=$1 AND b.blocker_id=${sent?'r.receiver_id':'r.sender_id'})) ORDER BY r.created_at DESC LIMIT 100`,[req.user.userId]);
    res.json(result.rows);
  }catch(error){console.error(error);res.status(500).json({error:'Unable to load message requests.'});}
});
router.post('/',async(req,res)=>{
  const {postId,message}=req.body||{};const sender=req.user.userId;
  if(!Number.isInteger(postId)||typeof message!=='string'||!message.trim()||message.trim().length>1000)return res.status(400).json({error:'Add an opening message of up to 1,000 characters.'});
  try{
    const post=await db.query("SELECT user_id FROM posts WHERE id=$1 AND visibility='public'",[postId]);
    if(!post.rowCount||!await canViewPost(postId,sender))return res.status(404).json({error:'Public post not found.'});
    const receiver=post.rows[0].user_id;if(receiver===sender)return res.status(400).json({error:'You cannot request your own aura.'});
    const connected=await db.query(matchSql,[sender,receiver]);
    if(connected.rowCount)return res.json({status:'connected',matchId:connected.rows[0].id,canChat:connected.rows[0].soul_game_completed});
    if(!await enforceText(req,res,message))return;
    const result=await db.query(`INSERT INTO aura_requests(sender_id,receiver_id,post_id,opening_message) VALUES($1,$2,$3,$4)
      ON CONFLICT(sender_id,receiver_id) DO NOTHING RETURNING id,status`,[sender,receiver,postId,message.trim()]);
    const request=result.rows[0]||(await db.query('SELECT id,status FROM aura_requests WHERE sender_id=$1 AND receiver_id=$2',[sender,receiver])).rows[0];
    if(request.status==='declined')return res.status(409).json({error:'This person has declined your request.'});
    res.status(result.rowCount?201:200).json({...request,message:'Aura sent to their message requests.'});
  }catch(error){console.error(error);res.status(500).json({error:'Unable to send aura request.'});}
});
router.post('/:id/:action',async(req,res)=>{
  if(!['accept','decline'].includes(req.params.action))return res.status(404).json({error:'Action not found.'});
  let client;
  try{
    client=await db.pool.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(68421001)');
    const result=await client.query('SELECT * FROM aura_requests WHERE id=$1 AND receiver_id=$2 FOR UPDATE',[Number(req.params.id),req.user.userId]);
    const request=result.rows[0];
    if(!request){await client.query('ROLLBACK');return res.status(404).json({error:'Request not found.'});}
    const blocked=await client.query('SELECT id FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',[request.sender_id,request.receiver_id]);
    if(blocked.rowCount){await client.query('ROLLBACK');return res.status(403).json({error:'This request is unavailable.'});}
    if(request.status!=='pending'){
      await client.query('COMMIT');return res.json({status:request.status,matchId:request.match_id});
    }
    if(req.params.action==='decline'){
      await client.query("UPDATE aura_requests SET status='declined',updated_at=NOW() WHERE id=$1",[request.id]);await client.query('COMMIT');return res.json({status:'declined'});
    }
    let match=await client.query(matchSql,[request.sender_id,request.receiver_id]);
    if(!match.rowCount)match=await client.query('INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES($1,$2,TRUE) RETURNING id',[request.sender_id,request.receiver_id]);
    else await client.query('UPDATE matches SET soul_game_completed=TRUE WHERE id=$1',[match.rows[0].id]);
    const matchId=match.rows[0].id;
    await client.query('INSERT INTO messages(match_id,sender_id,content,created_at) VALUES($1,$2,$3,$4)',[matchId,request.sender_id,request.opening_message,request.created_at]);
    await client.query("UPDATE aura_requests SET status='accepted',match_id=$1,updated_at=NOW() WHERE id=$2",[matchId,request.id]);
    await client.query('COMMIT');res.json({status:'accepted',matchId});
  }catch(error){if(client)await client.query('ROLLBACK');console.error(error);res.status(500).json({error:'Unable to update request.'});}
  finally{client?.release();}
});
module.exports=router;
