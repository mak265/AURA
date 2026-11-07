const { enforceImage } = require('../imageModeration');
const { enforceText } = require('../textModeration');
const { removeMessage } = require('../messageRemoval');
const { reactToMessage } = require('../messageReactions');
const { manageConversation } = require('../conversationActions');
const { presenceFieldsSql } = require('../presence');
const { parseAttachment } = require('../chatMedia');
const { visiblePostSql } = require('../postPrivacy');
const { receiptHandler } = require('../messageReceipts');
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.post('/:matchId/messages/:messageId/remove',authenticate,removeMessage);
router.post('/:matchId/manage',authenticate,manageConversation);
router.post('/:matchId/messages/:messageId/reaction',authenticate,reactToMessage);

// GET /api/matches - list all matches
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await db.query(
      `SELECT m.id, m.revealed, m.soul_game_completed, m.created_at, ${presenceFieldsSql()},
              COALESCE(cp.pinned,FALSE) AS pinned,COALESCE(cp.archived,FALSE) AS archived,COALESCE(cp.muted,FALSE) AS muted,COALESCE(cp.high_risk,FALSE) AS high_risk,
              EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=$1 AND b.blocked_id=u.id) AS blocked_by_me,
              u.id as other_user_id, CASE WHEN m.revealed AND NOT EXISTS(SELECT 1 FROM blocks photo_block WHERE (photo_block.blocker_id=$1 AND photo_block.blocked_id=u.id) OR (photo_block.blocked_id=$1 AND photo_block.blocker_id=u.id)) THEN u.profile_photo ELSE NULL END AS profile_photo, a.aura_name, a.aura_color, a.emoji,
              (SELECT CASE WHEN unsent_at IS NOT NULL THEN 'Message unsent' WHEN kind='image' THEN 'Photo' WHEN kind='audio' THEN 'Voice message' ELSE content END FROM messages WHERE match_id = m.id AND NOT EXISTS(SELECT 1 FROM hidden_messages hidden WHERE hidden.message_id=messages.id AND hidden.user_id=$1) AND (cp.deleted_at IS NULL OR created_at>cp.deleted_at) ORDER BY created_at DESC,id DESC LIMIT 1) as last_message,
              (SELECT created_at FROM messages WHERE match_id = m.id AND NOT EXISTS(SELECT 1 FROM hidden_messages hidden WHERE hidden.message_id=messages.id AND hidden.user_id=$1) AND (cp.deleted_at IS NULL OR created_at>cp.deleted_at) ORDER BY created_at DESC LIMIT 1) as last_message_at,
              CASE WHEN COALESCE(cp.muted,FALSE) OR EXISTS(SELECT 1 FROM blocks mb WHERE mb.blocker_id=$1 AND mb.blocked_id=u.id) THEN 0 ELSE (SELECT count(*) FROM messages WHERE match_id=m.id AND unsent_at IS NULL AND NOT EXISTS(SELECT 1 FROM hidden_messages hidden WHERE hidden.message_id=messages.id AND hidden.user_id=$1) AND sender_id!=$1 AND read_at IS NULL AND (cp.deleted_at IS NULL OR created_at>cp.deleted_at)) END AS unread
       FROM matches m
       JOIN users u ON (u.id = CASE WHEN m.user1_id = $1 THEN m.user2_id ELSE m.user1_id END)
       LEFT JOIN auras a ON a.user_id = u.id
       LEFT JOIN conversation_preferences cp ON cp.match_id=m.id AND cp.user_id=$1
       WHERE (m.user1_id=$1 OR m.user2_id=$1) AND (cp.deleted_at IS NULL OR EXISTS(SELECT 1 FROM messages fresh WHERE fresh.match_id=m.id AND fresh.created_at>cp.deleted_at))
       ORDER BY COALESCE(cp.pinned,FALSE) DESC, COALESCE(
         (SELECT created_at FROM messages WHERE match_id = m.id AND NOT EXISTS(SELECT 1 FROM hidden_messages hidden WHERE hidden.message_id=messages.id AND hidden.user_id=$1) ORDER BY created_at DESC LIMIT 1),
         m.created_at
       ) DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Get matches error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

router.get('/:matchId/details',authenticate,async(req,res)=>{
  try{
    const result=await db.query(`SELECT m.id,m.soul_game_completed,m.revealed,COALESCE(cp.high_risk,FALSE) AS high_risk
      FROM matches m LEFT JOIN conversation_preferences cp ON cp.match_id=m.id AND cp.user_id=$1
      WHERE m.id=$2 AND (m.user1_id=$1 OR m.user2_id=$1)`,[req.user.userId,Number(req.params.matchId)]);
    if(!result.rowCount)return res.status(404).json({error:'Conversation not found.'});
    res.json(result.rows[0]);
  }catch(error){res.status(500).json({error:'Unable to load conversation.'});}
});

// A revealed connection may view the partner's profile, with private account fields excluded.
router.get('/:matchId/profile', authenticate, async (req, res) => {
  try {
    const match = await db.query('SELECT * FROM matches WHERE id=$1 AND (user1_id=$2 OR user2_id=$2)', [Number(req.params.matchId),req.user.userId]);
    if (!match.rowCount) return res.status(404).json({ error: 'Connection not found.' });
    if (!match.rows[0].revealed) return res.status(403).json({ error: 'Both people must reveal their identities first.' });
    const otherId = match.rows[0].user1_id === req.user.userId ? match.rows[0].user2_id : match.rows[0].user1_id;
    const blocked = await db.query('SELECT id FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)', [req.user.userId,otherId]);
    if (blocked.rowCount) return res.status(403).json({ error: 'This profile is unavailable.' });
    const profile = await db.query(`SELECT u.id,u.real_name,u.age,u.gender,u.city,u.religion,u.profile_photo,
      a.aura_name,a.aura_color,a.vibe,a.bio,a.emoji,a.dating_intention,a.prompt_answers
      FROM users u LEFT JOIN auras a ON a.user_id=u.id WHERE u.id=$1`,[otherId]);
    if (!profile.rowCount) return res.status(404).json({ error: 'Profile not found.' });
    const interests = await db.query('SELECT i.name,i.emoji FROM interests i JOIN user_interests ui ON ui.interest_id=i.id WHERE ui.user_id=$1',[otherId]);
    const posts = await db.query(`SELECT p.id,p.image_url,p.caption,p.created_at,p.visibility,
      (SELECT count(*)::int FROM post_likes WHERE post_id=p.id) AS like_count,
      (SELECT count(*)::int FROM post_comments WHERE post_id=p.id) AS comment_count
      FROM posts p WHERE p.user_id=$1 AND ${visiblePostSql('p','$2')} ORDER BY p.created_at DESC LIMIT 20`,[otherId,req.user.userId]);
    res.json({ ...profile.rows[0], interests: interests.rows, posts: posts.rows });
  } catch (error) {
    console.error('Connection profile error:',error);
    res.status(500).json({ error: 'Unable to load profile.' });
  }
});

router.get('/:matchId/presence',authenticate,async(req,res)=>{
  try{
    const result=await db.query(`SELECT ${presenceFieldsSql()} FROM matches m JOIN users u ON u.id=CASE WHEN m.user1_id=$1 THEN m.user2_id ELSE m.user1_id END
      WHERE m.id=$2 AND (m.user1_id=$1 OR m.user2_id=$1)`,[req.user.userId,Number(req.params.matchId)]);
    if(!result.rowCount)return res.status(404).json({error:'Connection not found.'});
    res.json(result.rows[0]);
  }catch(error){console.error(error);res.status(500).json({error:'Unable to load activity.'});}
});

// GET /api/matches/:matchId/messages
router.get('/:matchId/messages', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const matchId = parseInt(req.params.matchId);

    const match = await db.query(
      'SELECT * FROM matches WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [matchId, userId]
    );
    if (match.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found.' });
    }

    const result = await db.query(
      `SELECT m.id, m.sender_id, m.content, m.created_at, m.read_at, m.delivered_at, m.unsent_at, m.kind, m.attachment_mime, m.duration_seconds,
              a.aura_name, a.aura_color, a.emoji, COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id',mr.user_id,'reaction',mr.reaction) ORDER BY mr.user_id) FROM message_reactions mr WHERE mr.message_id=m.id),'[]'::jsonb) AS reactions
       FROM messages m
       JOIN auras a ON a.user_id = m.sender_id
       WHERE m.match_id = $1 AND NOT EXISTS(SELECT 1 FROM hidden_messages h WHERE h.message_id=m.id AND h.user_id=$2) AND NOT EXISTS(SELECT 1 FROM conversation_preferences deleted WHERE deleted.user_id=$2 AND deleted.match_id=$1 AND m.created_at<=deleted.deleted_at)
       ORDER BY m.created_at ASC`,
      [matchId,userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Media is served only to conversation participants, never through a public URL.
router.get('/:matchId/messages/:messageId/media', authenticate, async(req,res)=>{
  try{
    const result=await db.query(`SELECT msg.attachment,msg.attachment_mime FROM messages msg JOIN matches m ON m.id=msg.match_id
      WHERE msg.id=$1 AND m.id=$2 AND (m.user1_id=$3 OR m.user2_id=$3) AND msg.attachment IS NOT NULL AND msg.unsent_at IS NULL AND NOT EXISTS(SELECT 1 FROM hidden_messages h WHERE h.message_id=msg.id AND h.user_id=$3)
      AND NOT EXISTS(SELECT 1 FROM conversation_preferences deleted WHERE deleted.user_id=$3 AND deleted.match_id=m.id AND msg.created_at<=deleted.deleted_at)
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=m.user1_id AND b.blocked_id=m.user2_id) OR (b.blocker_id=m.user2_id AND b.blocked_id=m.user1_id))`,[Number(req.params.messageId),Number(req.params.matchId),req.user.userId]);
    if(!result.rowCount)return res.status(404).json({error:'Attachment not found.'});
    res.set({'Content-Type':result.rows[0].attachment_mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'});
    res.send(result.rows[0].attachment);
  }catch(error){console.error(error);res.status(500).json({error:'Unable to load attachment.'});}
});

router.post('/:matchId/receipts', authenticate, receiptHandler('match'));

// POST /api/matches/:matchId/messages
router.post('/:matchId/messages', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const matchId = parseInt(req.params.matchId);
    const { content = '', kind = 'text', media, duration } = req.body;

    if (typeof content!=='string' || content.length>5000 || !['text','image','audio'].includes(kind) || (kind==='text' && (!content.trim() || media!==undefined))) {
      return res.status(400).json({ error: 'Message content is required.' });
    }

    const match = await db.query(
      'SELECT * FROM matches WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [matchId, userId]
    );
    if (match.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found.' });
    }

    // Check if blocked
    const otherUserId = match.rows[0].user1_id === userId ? match.rows[0].user2_id : match.rows[0].user1_id;
    const blocked = await db.query(
      'SELECT id FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)',
      [otherUserId, userId]
    );
    if (blocked.rows.length > 0) {
      return res.status(403).json({ error: 'You cannot message this user.' });
    }

    // Check soul game completion gate
    if (!match.rows[0].soul_game_completed) {
      return res.status(403).json({
        error: 'Complete the Soul Game first to unlock direct messaging.',
        code: 'SOUL_GAME_REQUIRED',
      });
    }

    if(!await enforceText(req,res,content,{strict:false}))return;
    let attachment=null;
    if(kind!=='text'){
      try{attachment=parseAttachment(kind,media,duration);}
      catch(error){return res.status(400).json({error:error.message});}
    }
    if(kind==='image'&&!await enforceImage(req,res,media))return;
    const result = await db.query(
      `INSERT INTO messages (match_id, sender_id, content,kind,attachment,attachment_mime,duration_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, match_id, sender_id, content, created_at,kind,attachment_mime,duration_seconds`,
      [matchId, userId, content.trim(),kind,attachment?.bytes||null,attachment?.mime||null,attachment?.duration||null]
    );

    const message = result.rows[0];
    const aura = await db.query(
      'SELECT aura_name, aura_color, emoji FROM auras WHERE user_id = $1',
      [userId]
    );
    message.aura_name = aura.rows[0]?.aura_name || 'Anonymous';
    message.aura_color = aura.rows[0]?.aura_color || 'violet';
    message.emoji = aura.rows[0]?.emoji || '🌌';

    // Emit via socket.io
    const io = req.app.get('io');
    if (io) {
      io.to(`match:${matchId}`).emit('message', message);
    }

    res.status(201).json(message);
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/matches/:matchId/soul-game/complete - mark soul game as completed
router.post('/:matchId/soul-game/complete', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const matchId = parseInt(req.params.matchId);

    const match = await db.query(
      'SELECT * FROM matches WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [matchId, userId]
    );
    if (match.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found.' });
    }

    if (match.rows[0].soul_game_completed) {
      return res.json({ soul_game_completed: true, already_completed: true });
    }

    await db.query(
      'UPDATE matches SET soul_game_completed = TRUE WHERE id = $1',
      [matchId]
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`match:${matchId}`).emit('soul_game:completed', { matchId });
    }

    res.json({ soul_game_completed: true, message: 'Soul Game completed! Direct messaging unlocked.' });
  } catch (err) {
    console.error('Soul game complete error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/matches/:matchId/reveal/status
router.get('/:matchId/reveal/status', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const matchId = parseInt(req.params.matchId);

    const match = await db.query(
      'SELECT * FROM matches WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [matchId, userId]
    );
    if (match.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found.' });
    }

    const matchData = match.rows[0];
    if (matchData.revealed) {
      // Both revealed - return real names
      const otherUserId = matchData.user1_id === userId ? matchData.user2_id : matchData.user1_id;
      const other = await db.query(
        'SELECT real_name, profile_photo FROM users WHERE id = $1',
        [otherUserId]
      );
      return res.json({
        status: 'mutual',
        real_name: other.rows[0]?.real_name || null,
        profile_photo: other.rows[0]?.profile_photo || null,
      });
    }

    // Check reveal requests
    const requests = await db.query(
      'SELECT * FROM reveal_requests WHERE match_id = $1 AND status = $2',
      [matchId, 'pending']
    );

    if (requests.rows.length === 0) {
      return res.json({ status: 'none' });
    }

    const byMe = requests.rows.find(r => r.requester_id === userId);
    const byThem = requests.rows.find(r => r.requester_id !== userId);

    if (byMe && byThem) {
      // Both requested - mark as mutual
      await db.query('UPDATE matches SET revealed = TRUE WHERE id = $1', [matchId]);
      await db.query(
        "UPDATE reveal_requests SET status = 'mutual', updated_at = NOW() WHERE match_id = $1",
        [matchId]
      );
      const otherUserId = matchData.user1_id === userId ? matchData.user2_id : matchData.user1_id;
      const other = await db.query('SELECT real_name FROM users WHERE id = $1', [otherUserId]);
      return res.json({
        status: 'mutual',
        real_name: other.rows[0]?.real_name || null,
      });
    }

    if (byMe) {
      return res.json({ status: 'requested_by_me' });
    }

    if (byThem) {
      return res.json({ status: 'requested_by_them' });
    }

    res.json({ status: 'none' });
  } catch (err) {
    console.error('Reveal status error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/matches/:matchId/reveal/request
router.post('/:matchId/reveal/request', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const matchId = parseInt(req.params.matchId);

    const match = await db.query(
      'SELECT * FROM matches WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [matchId, userId]
    );
    if (match.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found.' });
    }

    const matchData = match.rows[0];
    const otherUserId = matchData.user1_id === userId ? matchData.user2_id : matchData.user1_id;

    // Create or update reveal request
    await db.query(
      `INSERT INTO reveal_requests (match_id, requester_id, confirmer_id, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (match_id, requester_id) DO NOTHING`,
      [matchId, userId, otherUserId]
    );

    // Check if both have requested now -> mutual
    const requests = await db.query(
      'SELECT requester_id FROM reveal_requests WHERE match_id = $1 AND status = $2',
      [matchId, 'pending']
    );
    const requesters = requests.rows.map(r => r.requester_id);
    let mutual = false;
    if (requesters.includes(userId) && requesters.includes(otherUserId)) {
      await db.query('UPDATE matches SET revealed = TRUE WHERE id = $1', [matchId]);
      await db.query(
        "UPDATE reveal_requests SET status = 'mutual', updated_at = NOW() WHERE match_id = $1",
        [matchId]
      );
      mutual = true;
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`match:${matchId}`).emit('reveal:update', { matchId, mutual });
    }

    res.json({
      message: mutual ? 'Identity revealed!' : 'Reveal request sent.',
      mutual,
    });
  } catch (err) {
    console.error('Reveal request error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;


