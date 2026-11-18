const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { notifyActivity } = require('../messageAlerts');
const { finishConnectionCalls } = require('../connectionCallHistory');

router.use(authenticate, (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

async function inConnection(req, res, action) {
  const matchId = Number(req.params.matchId);
  const userId = req.user.userId;
  if (!Number.isInteger(matchId) || matchId < 1 || matchId > 2147483647) {
    return res.status(404).json({ error: 'Connection unavailable.' });
  }
  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');
    const allowed = await client.query(`
      SELECT CASE WHEN m.user1_id = $2 THEN m.user2_id ELSE m.user1_id END AS partner_id FROM matches m
      JOIN users a ON a.id = m.user1_id JOIN users b ON b.id = m.user2_id
      WHERE m.id = $1 AND $2 IN (m.user1_id, m.user2_id) AND m.soul_game_completed
        AND a.banned_at IS NULL AND b.banned_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM blocks WHERE
          (blocker_id = m.user1_id AND blocked_id = m.user2_id) OR
          (blocker_id = m.user2_id AND blocked_id = m.user1_id))
      FOR UPDATE OF m
    `, [matchId, userId]);
    if (!allowed.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Connection unavailable.' });
    }
    const [status, body] = await action(client, matchId, userId);
    await client.query('COMMIT');
    res.status(status).json(body);
    if (status === 201) {
      notifyActivity(req.app.get('io'), allowed.rows[0].partner_id, userId, {
        matchId, path: `/chat/${matchId}`, body: 'Incoming AURA voice call',
      }).catch(error => console.warn('Connection call alert:', error.code || error.name));
    }
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Connection call:', error.code || error.name);
    res.status(503).json({ error: 'Calling is temporarily unavailable.' });
  } finally {
    client?.release();
  }
}

async function currentCall(client, matchId) {
  const { rows } = await client.query(
    `SELECT id, caller_id, status, connected_at FROM connection_calls
     WHERE match_id = $1 AND expires_at > NOW()
       AND (status = 'ringing' OR LEAST(caller_seen_at, recipient_seen_at) > NOW() - INTERVAL '75 seconds')`,
    [matchId],
  );
  return rows[0] || null;
}

router.get('/', (req, res) => inConnection(req, res, async (client, matchId) => {
  const call = await currentCall(client, matchId);
  if (!call) await finishConnectionCalls(client, { matchId });
  return [200, { call }];
}));

router.post('/', (req, res) => inConnection(req, res, async (client, matchId, userId) => {
  const existing = await currentCall(client, matchId);
  if (existing) return [200, { call: existing }];
  await finishConnectionCalls(client, { matchId });
  const { rows: [call] } = await client.query(`
    INSERT INTO connection_calls (match_id, caller_id, status, expires_at)
    VALUES ($1, $2, 'ringing', NOW() + INTERVAL '40 seconds') RETURNING id, caller_id, status
  `, [matchId, userId]);
  return [201, { call }];
}));

router.post('/:callId/:action(accept|connected|end)', (req, res) => inConnection(req, res, async (client, matchId, userId) => {
  const call = await currentCall(client, matchId);
  if (!call || call.id !== Number(req.params.callId)) return [409, { error: 'This call has ended.' }];
  if (req.params.action === 'end') {
    await finishConnectionCalls(client, { matchId, callId: call.id, userId });
    return [200, { call: null }];
  }
  if (req.params.action === 'connected') {
    if (call.status !== 'active') return [409, { error: 'The call has not been answered.' }];
    const { rows: [connected] } = await client.query(`
      UPDATE connection_calls SET connected_at = COALESCE(connected_at, NOW())
      WHERE id = $1 RETURNING id, caller_id, status, connected_at
    `, [call.id]);
    return [200, { call: connected }];
  }
  if (call.caller_id === userId) return [403, { error: 'Only the recipient can answer.' }];
  if (call.status === 'ringing') {
    await client.query(`UPDATE connection_calls SET status = 'active', expires_at = NOW() + INTERVAL '2 hours',
      caller_seen_at = NOW(), recipient_seen_at = NOW() WHERE id = $1`, [call.id]);
  }
  return [200, { call: { ...call, status: 'active' } }];
}));

function activeSignals(req, res, action) {
  return inConnection(req, res, async (client, matchId, userId) => {
    const call = await currentCall(client, matchId);
    if (!call || call.id !== Number(req.params.callId) || call.status !== 'active') {
      return [409, { error: 'This call has ended.' }];
    }
    return action(client, call, userId);
  });
}

router.get('/:callId/signals', (req, res) => activeSignals(req, res, async (client, call, userId) => {
  const after = Number(req.query.after || 0);
  if (!Number.isInteger(after) || after < 0 || after > 2147483647) return [400, { error: 'Invalid signal cursor.' }];
  const heartbeat = call.caller_id === userId ? 'caller_seen_at' : 'recipient_seen_at';
  await client.query(`UPDATE connection_calls SET ${heartbeat} = NOW()
    WHERE id = $1 AND ${heartbeat} < NOW() - INTERVAL '10 seconds'`, [call.id]);
  const { rows } = await client.query(
    'SELECT id, payload FROM connection_call_signals WHERE call_id = $1 AND sender_id <> $2 AND id > $3 ORDER BY id LIMIT 250',
    [call.id, userId, after],
  );
  return [200, rows];
}));

router.post('/:callId/signals', (req, res) => activeSignals(req, res, async (client, call, userId) => {
  const payload = req.body;
  if (!payload || !['offer', 'answer', 'candidate'].includes(payload.type) ||
      JSON.stringify(payload).length > 20000 ||
      (payload.type === 'candidate' ? !payload.candidate || typeof payload.candidate !== 'object' : typeof payload.sdp !== 'string')) {
    return [400, { error: 'Invalid call signal.' }];
  }
  if ((payload.type === 'offer' && call.caller_id !== userId) || (payload.type === 'answer' && call.caller_id === userId)) {
    return [403, { error: 'Invalid call role.' }];
  }
  const { rows: [usage] } = await client.query(
    'SELECT count(*)::int AS count FROM connection_call_signals WHERE call_id = $1 AND sender_id = $2', [call.id, userId],
  );
  if (usage.count >= 200) return [429, { error: 'Too many call signals.' }];
  await client.query('INSERT INTO connection_call_signals (call_id, sender_id, payload) VALUES ($1, $2, $3)', [call.id, userId, payload]);
  return [200, { ok: true }];
}));

module.exports = router;
