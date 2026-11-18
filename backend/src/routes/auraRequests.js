const { enforceText } = require('../textModeration');
const { profileVisibleSql } = require('../profileVisibility');
const express=require('express');
const db=require('../db');
const {authenticate}=require('../middleware/auth');
const {visiblePostSql}=require('../postPrivacy');
const router=express.Router();router.use(authenticate);
const matchSql=`SELECT id,soul_game_completed FROM matches WHERE (user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1) ORDER BY id LIMIT 1`;
const REQUESTS_PER_HOUR = 10;
const REQUEST_SENDER_LOCK = 68421003;

router.get('/',async(req,res)=>{
  const direction=req.query.direction || 'received';
  if(!['received','sent'].includes(direction))return res.status(400).json({error:'Choose received or sent requests.'});
  const sent=direction==='sent';
  try{
    const result=await db.query(`SELECT r.id,r.sender_id,r.receiver_id,r.opening_message,r.status,r.match_id,r.created_at,
      CASE WHEN ${profileVisibleSql(sent?'r.receiver_id':'r.sender_id','$1')} THEN a.aura_name ELSE 'Private member' END AS aura_name,
      CASE WHEN ${profileVisibleSql(sent?'r.receiver_id':'r.sender_id','$1')} THEN a.emoji ELSE NULL END AS emoji,
      CASE WHEN ${profileVisibleSql(sent?'r.receiver_id':'r.sender_id','$1')} THEN a.bio ELSE NULL END AS bio,
      CASE WHEN p.id IS NOT NULL THEN jsonb_build_object(
        'id', p.id, 'caption', LEFT(p.caption, 240), 'has_image', COALESCE(p.image_url <> '', FALSE)
      ) END AS post_preview
      FROM aura_requests r LEFT JOIN auras a ON a.user_id=${sent?'r.receiver_id':'r.sender_id'}
      LEFT JOIN posts p ON p.id=r.post_id AND p.user_id=r.receiver_id AND ${visiblePostSql('p', 'r.sender_id')}
      WHERE ${sent?'r.sender_id':'r.receiver_id'}=$1 ${sent?'':"AND r.status='pending'"} AND NOT EXISTS(SELECT 1 FROM blocks b
        WHERE (b.blocker_id=$1 AND b.blocked_id=${sent?'r.receiver_id':'r.sender_id'}) OR (b.blocked_id=$1 AND b.blocker_id=${sent?'r.receiver_id':'r.sender_id'})) ORDER BY r.created_at DESC LIMIT 100`,[req.user.userId]);
    res.set('Cache-Control','no-store').json(result.rows);
  }catch(error){console.error(error);res.status(500).json({error:'Unable to load message requests.'});}
});
router.post('/',async(req,res)=>{
  const {postId, message} = req.body || {};
  const sender = req.user.userId;
  const opener = typeof message === 'string' ? message.trim() : '';
  if (!Number.isInteger(postId) || postId < 1 || postId > 2147483647 || !opener || opener.length > 1000) {
    return res.status(400).json({error: 'Choose a post and add an opening message of up to 1,000 characters.'});
  }

  const publicPost = `p.id=$1 AND p.visibility='public' AND ${visiblePostSql('p', '$2')}`;
  let client;
  try {
    const post = await db.query(`SELECT p.user_id FROM posts p WHERE ${publicPost}`, [postId, sender]);
    if (!post.rowCount) return res.status(404).json({error: 'Public post not found.'});
    const receiver = post.rows[0].user_id;
    if (receiver === sender) return res.status(400).json({error: 'You cannot request your own aura.'});
    const connected = await db.query(matchSql, [sender, receiver]);
    if (connected.rowCount) {
      const match = connected.rows[0];
      return res.json({status: 'connected', matchId: match.id, canChat: match.soul_game_completed});
    }
    if (!await enforceText(req, res, opener)) return;

    client = await db.pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [REQUEST_SENDER_LOCK, sender]);
    const existing = await client.query('SELECT id,status FROM aura_requests WHERE sender_id=$1 AND receiver_id=$2', [sender, receiver]);
    if (existing.rowCount) {
      await client.query('COMMIT');
      const request = existing.rows[0];
      if (request.status === 'declined') return res.status(409).json({error: 'This person has declined your request.'});
      return res.json({...request, message: 'Aura sent to their message requests.'});
    }

    const { rows: [recent] } = await client.query(`SELECT count(*)::int AS count,
      CEIL(EXTRACT(EPOCH FROM MIN(created_at) + INTERVAL '1 hour' - statement_timestamp()))::int AS retry_after
      FROM aura_requests WHERE sender_id=$1 AND created_at > statement_timestamp() - INTERVAL '1 hour'`, [sender]);
    if (recent.count >= REQUESTS_PER_HOUR) {
      await client.query('COMMIT');
      return res.set('Retry-After', String(Math.max(1, recent.retry_after))).status(429)
        .json({error: 'You have sent too many Aura requests. Try again later.'});
    }

    const result = await client.query(`INSERT INTO aura_requests(sender_id, receiver_id, post_id, opening_message, created_at)
      SELECT $2, p.user_id, p.id, $3, statement_timestamp() FROM posts p WHERE ${publicPost}
      RETURNING id, status`, [postId, sender, opener]);
    await client.query('COMMIT');
    if (!result.rowCount) return res.status(404).json({error: 'Public post not found.'});
    return res.status(201).json({...result.rows[0], message: 'Aura sent to their message requests.'});
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({error: 'Unable to send aura request.'});
  } finally {
    client?.release();
  }
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
