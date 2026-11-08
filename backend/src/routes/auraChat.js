const {allowance} = require('../auraFarming');
const { enforceText } = require('../textModeration');
const { receiptHandler } = require('../messageReceipts');
const { revealSoulTalk } = require('../soulTalkReveal');
const { startSearch, heartbeat } = require('../soulTalkQueue');
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/allowance', authenticate, async(req,res)=>{
  try { res.set('Cache-Control','no-store').json(await allowance(db,req.user.userId)); }
  catch { res.status(503).json({error:'Unable to load your Aura Farming allowance.'}); }
});
router.get('/call-config', authenticate, (_req,res)=>{
  try {
    const iceServers=process.env.WEBRTC_ICE_SERVERS ? JSON.parse(process.env.WEBRTC_ICE_SERVERS) : [{urls:'stun:stun.l.google.com:19302'}];
    if (!Array.isArray(iceServers)) throw new Error('Invalid ICE configuration');
    res.set('Cache-Control','no-store').json({iceServers});
  } catch { res.status(503).json({error:'Calls are temporarily unavailable.'}); }
});

// Signaling is authenticated, session-scoped and expires with the active call.
router.get('/:sessionId/signals', authenticate, async(req,res)=>{
  try {
    const session=await getSessionForUser(Number(req.params.sessionId),req.user.userId);
    if (!session) return res.status(404).json({error:'Call not found.'});
    if (session.mode!=='call'||session.status!=='active'||!session.user2_id||Date.now()-new Date(session.created_at).getTime()>=300000) return res.status(409).json({error:'Call is no longer active.'});
    const after=Number(req.query.after||0);
    if (!Number.isSafeInteger(after)||after<0) return res.status(400).json({error:'Invalid signal cursor.'});
    const result=await db.query('SELECT id,payload FROM farming_signals WHERE session_id=$1 AND sender_id<>$2 AND id>$3 ORDER BY id LIMIT 250',[session.id,req.user.userId,after]);
    res.set('Cache-Control','no-store').json(result.rows);
  } catch { res.status(500).json({error:'Unable to connect call.'}); }
});
router.post('/:sessionId/signals', authenticate, async(req,res)=>{
  const payload=req.body;
  if (!payload||!['offer','answer','candidate'].includes(payload.type)||JSON.stringify(payload).length>20000) return res.status(400).json({error:'Invalid call signal.'});
  if (payload.type==='candidate' ? !payload.candidate || typeof payload.candidate!=='object' : typeof payload.sdp!=='string') return res.status(400).json({error:'Invalid call signal.'});
  let client;
  try {
    client=await db.pool.connect();
    await client.query('BEGIN');
    const result=await client.query('SELECT * FROM aura_sessions WHERE id=$1 AND (user1_id=$2 OR user2_id=$2) FOR UPDATE',[Number(req.params.sessionId),req.user.userId]);
    const session=result.rows[0];
    if (!session) { await client.query('ROLLBACK');return res.status(404).json({error:'Call not found.'}); }
    if (session.mode!=='call'||session.status!=='active'||!session.user2_id||Date.now()-new Date(session.created_at).getTime()>=300000) { await client.query('ROLLBACK');return res.status(409).json({error:'Call is no longer active.'}); }
    const count=await client.query('SELECT count(*)::int AS count FROM farming_signals WHERE session_id=$1 AND sender_id=$2',[session.id,req.user.userId]);
    if (count.rows[0].count>=200) {await client.query('ROLLBACK');return res.status(429).json({error:'Too many call signals.'});}
    if ((payload.type==='offer' && session.user1_id!==req.user.userId)||(payload.type==='answer' && session.user2_id!==req.user.userId)) {await client.query('ROLLBACK');return res.status(403).json({error:'Invalid call role.'});}
    await client.query('INSERT INTO farming_signals(session_id,sender_id,payload) VALUES($1,$2,$3)',[session.id,req.user.userId,JSON.stringify(payload)]);
    await client.query('COMMIT');res.json({ok:true});
  } catch { if(client)await client.query('ROLLBACK');res.status(500).json({error:'Unable to connect call.'}); }
  finally {client?.release();}
});


async function getSessionForUser(sessionId, userId) {
  const result = await db.query(
    `SELECT *
     FROM aura_sessions
     WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)`,
    [sessionId, userId]
  );
  return result.rows[0] || null;
}

async function buildSessionPayload(sessionId, userId) {
  const session = await getSessionForUser(sessionId, userId);
  if (!session) return null;

  if (session.status === 'waiting') {
    const expired = await db.query(`UPDATE aura_sessions SET status = 'ended'
      WHERE id = $1 AND status = 'waiting' AND (search_expires_at IS NULL OR search_expires_at <= NOW()) RETURNING id`, [sessionId]);
    if (expired.rowCount) session.status = 'ended';
  }
  let status = session.status;
  let secondsRemaining = 0;
  let expiresAt = null;

  if (status === 'active' && session.user2_id) {
    const timing = await db.query(
      `SELECT
         GREATEST(
           0,
           CEIL(EXTRACT(EPOCH FROM ((created_at + INTERVAL '5 minutes') - NOW())))
         )::int AS seconds_remaining,
         (created_at + INTERVAL '5 minutes') AS expires_at
       FROM aura_sessions
       WHERE id = $1`,
      [sessionId]
    );

    secondsRemaining = timing.rows[0]?.seconds_remaining || 0;
    expiresAt = timing.rows[0]?.expires_at ? new Date(timing.rows[0].expires_at).toISOString() : null;

    if (secondsRemaining <= 0) {
      await db.query(
        "UPDATE aura_sessions SET status = 'ended' WHERE id = $1 AND status = 'active'",
        [sessionId]
      );
      status = 'ended';
      secondsRemaining = 0;
    }
  }

  const otherUserId = session.user1_id === userId ? session.user2_id : session.user1_id;
  let partner = null;
  let matchId = null;

  if (otherUserId) {
    const partnerResult = await db.query(
      `SELECT u.id, a.aura_name, a.aura_color, a.vibe, a.bio, a.emoji
       FROM users u
       LEFT JOIN auras a ON a.user_id = u.id
       WHERE u.id = $1`,
      [otherUserId]
    );
    partner = partnerResult.rows[0] || null;

    if (status === 'matched') {
      const matchResult = await db.query(
        `SELECT id
         FROM matches
         WHERE (user1_id = $1 AND user2_id = $2)
            OR (user1_id = $2 AND user2_id = $1)
         LIMIT 1`,
        [session.user1_id, session.user2_id]
      );
      matchId = matchResult.rows[0]?.id || null;
    }
  }

  let revealRequested = false;
  let partnerRevealRequested = false;
  if (session.user2_id && ['active', 'ended'].includes(status)) {
    const requests = await db.query(`SELECT user_id FROM aura_session_answers
      WHERE session_id=$1 AND round=98 AND answer='reveal_identity'`, [sessionId]);
    revealRequested = requests.rows.some(row => row.user_id === userId);
    partnerRevealRequested = requests.rows.some(row => row.user_id === otherUserId);
  }
  return {
    mode: session.mode,
    initiator: session.user1_id === userId,
    canReveal: status === 'active' && !!session.user2_id && secondsRemaining <= 240,
    revealRequested,
    partnerRevealRequested,
    sessionId: session.id,
    status,
    secondsRemaining,
    expiresAt,
    partner,
    matchId,
    canChat: status === 'active' && !!session.user2_id && secondsRemaining > 0,
    canKeepTalking: status === 'ended' && !!session.user2_id,
  };
}

// Both random searches and match-specific talks require two live searches.
router.post('/start', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const partnerId = req.body?.partnerId ?? null;
    if (partnerId !== null && (!Number.isInteger(partnerId) || partnerId <= 0 || partnerId === userId)) {
      return res.status(400).json({ error: 'Choose a valid match.' });
    }
    const sessionId = await startSearch(userId, partnerId, req.body);
    res.json(await buildSessionPayload(sessionId, userId));
  } catch (error) {
    console.error('Aura chat start error:', error);
    res.status(error.status || 500).json({ code:error.code, error: error.status ? error.message : 'Unable to start Aura Farming.' });
  }
});

router.post('/:sessionId/heartbeat', authenticate, async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    await heartbeat(sessionId, req.user.userId);
    const payload = await buildSessionPayload(sessionId, req.user.userId);
    if (!payload) return res.status(404).json({ error: 'Session not found.' });
    res.json(payload);
  } catch (error) {
    console.error('Soul Talk heartbeat error:', error);
    res.status(500).json({ error: 'Unable to refresh search.' });
  }
});

// GET /api/aura-chat/:sessionId/status
router.get('/:sessionId/status', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const sessionId = parseInt(req.params.sessionId, 10);

    const payload = await buildSessionPayload(sessionId, userId);
    if (!payload) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    res.json(payload);
  } catch (err) {
    console.error('Aura chat status error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/aura-chat/:sessionId/messages
router.get('/:sessionId/messages', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const sessionId = parseInt(req.params.sessionId, 10);

    const session = await getSessionForUser(sessionId, userId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const result = await db.query(
      `SELECT m.id, m.sender_id, m.content, m.created_at, m.delivered_at, m.read_at,
              a.aura_name, a.aura_color, a.emoji
       FROM aura_session_messages m
       LEFT JOIN auras a ON a.user_id = m.sender_id
       WHERE m.session_id = $1
       ORDER BY m.created_at ASC`,
      [sessionId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Aura chat messages error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

router.post('/:sessionId/receipts', authenticate, receiptHandler('soul'));

// Serialize sends with identity reveal so no in-flight message is lost during transfer.
router.post('/:sessionId/messages', authenticate, async (req, res) => {
  const content = req.body?.content;
  if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: 'Message content is required.' });
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const result = await client.query(`SELECT *, created_at > NOW() - INTERVAL '5 minutes' AS within_time
      FROM aura_sessions WHERE id=$1 AND (user1_id=$2 OR user2_id=$2) FOR UPDATE`, [Number(req.params.sessionId),req.user.userId]);
    const session = result.rows[0];
    if (!session) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Session not found.' });
    }
    if (session.status !== 'active' || !session.user2_id || !session.within_time) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This anonymous chat is not active. Open your connection to continue.' });
    }
    if(!await enforceText(req,res,content)){await client.query('ROLLBACK');return;}
    const messageResult = await client.query(`INSERT INTO aura_session_messages(session_id,sender_id,content)
      VALUES($1,$2,$3) RETURNING id,session_id,sender_id,content,created_at`, [session.id,req.user.userId,content.trim()]);
    const aura = await client.query('SELECT aura_name,aura_color,emoji FROM auras WHERE user_id=$1',[req.user.userId]);
    await client.query('COMMIT');
    res.status(201).json({ ...messageResult.rows[0], ...aura.rows[0] });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Aura chat send error:',error);
    res.status(500).json({ error: 'Unable to send message.' });
  } finally { client?.release(); }
});

// Both buttons share the same mutual identity-consent flow.
async function requestIdentity(req, res) {
  try {
    res.json(await revealSoulTalk(Number(req.params.sessionId), req.user.userId));
  } catch (error) {
    console.error('Soul Talk identity request error:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to show identity.' });
  }
}
router.post('/:sessionId/reveal', authenticate, requestIdentity);
router.post('/:sessionId/keep-talking', authenticate, requestIdentity);

// POST /api/aura-chat/:sessionId/end
router.post('/:sessionId/end', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const sessionId = parseInt(req.params.sessionId, 10);

    const session = await getSessionForUser(sessionId, userId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    await db.query("UPDATE aura_sessions SET status = 'ended' WHERE id = $1", [sessionId]);
    res.json({ message: 'Aura chat ended anonymously.' });
  } catch (err) {
    console.error('End chat error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
