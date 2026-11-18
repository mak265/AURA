const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { authenticate } = require('../middleware/auth');

router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
}, authenticate);

const planFields = 'id, type, proposer_id, proposed_at, agreed_at, revision, created_at';
const unavailable = { error: 'Planning is unavailable for this connection.' };

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 && value <= 2147483647;
}

function validProposedTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = new Date(value);
  return +time > Date.now() && time.toISOString() === value;
}

async function inConnection(req, res, action) {
  const matchId = Number(req.params.matchId);
  const userId = req.user.userId;
  if (!positiveInteger(matchId)) return res.status(404).json(unavailable);
  let client;
  try {
    if (req.method !== 'GET') {
      client = await db.pool.connect();
      await client.query('BEGIN');
      // Serialize changes and recheck eligibility after taking the conversation lock.
      await client.query('SELECT id FROM matches WHERE id = $1 AND $2 IN (user1_id, user2_id) FOR UPDATE', [matchId, userId]);
    }
    const queryable = client || db;
    const { rows: [connection] } = await queryable.query(`
      SELECT p.deleted_at FROM matches m
      JOIN users a ON a.id = m.user1_id
      JOIN users b ON b.id = m.user2_id
      LEFT JOIN conversation_preferences p ON p.match_id = m.id AND p.user_id = $2
      WHERE m.id = $1 AND $2 IN (m.user1_id, m.user2_id)
        AND m.revealed AND m.soul_game_completed AND a.banned_at IS NULL AND b.banned_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM blocks WHERE
            (blocker_id = m.user1_id AND blocked_id = m.user2_id) OR
            (blocker_id = m.user2_id AND blocked_id = m.user1_id)
        )
    `, [matchId, userId]);
    const [status, body] = connection
      ? await action(queryable, matchId, userId, connection.deleted_at)
      : [404, unavailable];
    if (client) await client.query('COMMIT');
    return res.status(status).json(body);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Connection plans:', error.code || error.name);
    return res.status(503).json({ error: 'Planning is temporarily unavailable.' });
  } finally {
    client?.release();
  }
}

router.get('/', (req, res) => inConnection(req, res, async (queryable, matchId, _userId, deletedAt) => {
  const { rows } = await queryable.query(`
    SELECT ${planFields} FROM connection_plans WHERE match_id = $1
      AND ($2::timestamptz IS NULL OR created_at > $2)
    ORDER BY created_at, id
  `, [matchId, deletedAt]);
  return [200, rows];
}));

router.post('/', (req, res) => inConnection(req, res, async (client, matchId, userId, deletedAt) => {
  const { type, proposedAt, clientPlanId } = req.body || {};
  if (!['call', 'meetup'].includes(type) || typeof clientPlanId !== 'string' ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(clientPlanId)) {
    return [400, { error: 'Choose a call or meetup and try again.' }];
  }
  const { rows: [existing] } = await client.query(`
    SELECT ${planFields} FROM connection_plans WHERE match_id = $1 AND created_by = $2 AND client_plan_id = $3
  `, [matchId, userId, clientPlanId]);
  if (existing) {
    if (deletedAt && existing.created_at <= deletedAt) return [409, { error: 'Start a new plan.' }];
    return [200, existing];
  }
  if (!validProposedTime(proposedAt)) return [400, { error: 'Choose a date and time in the future.' }];
  const { rows: [plan] } = await client.query(`
    INSERT INTO connection_plans (match_id, created_by, client_plan_id, type, proposer_id, proposed_at)
    VALUES ($1, $2, $3, $4, $2, $5) RETURNING ${planFields}
  `, [matchId, userId, clientPlanId, type, proposedAt]);
  return [201, plan];
}));

router.patch('/:planId', (req, res) => inConnection(req, res, async (client, matchId, userId, deletedAt) => {
  const id = Number(req.params.planId);
  if (!positiveInteger(id)) return [404, { error: 'Plan unavailable.' }];
  const { action, revision, proposedAt } = req.body || {};
  if (!['accept', 'suggest'].includes(action) || !positiveInteger(revision)) {
    return [400, { error: 'Choose a valid response to this plan.' }];
  }
  const { rows: [plan] } = await client.query(`
    SELECT ${planFields} FROM connection_plans WHERE id = $1 AND match_id = $2
      AND ($3::timestamptz IS NULL OR created_at > $3)
  `, [id, matchId, deletedAt]);
  if (!plan) return [404, { error: 'Plan unavailable.' }];
  if (plan.revision !== revision || plan.agreed_at) return [409, { error: 'This plan has changed.' }];
  if (plan.proposer_id === userId) return [403, { error: 'Your connection can respond to your suggestion.' }];

  let rows;
  if (action === 'accept') {
    ({ rows } = await client.query(`
      UPDATE connection_plans SET agreed_at = proposed_at, revision = revision + 1
      WHERE id = $1 AND proposed_at > clock_timestamp() RETURNING ${planFields}
    `, [id]));
    if (!rows.length) return [409, { error: 'That time has passed. Suggest another time.' }];
  } else {
    if (!validProposedTime(proposedAt) || new Date(proposedAt).getTime() === plan.proposed_at.getTime()) {
      return [400, { error: 'Choose a different time in the future.' }];
    }
    ({ rows } = await client.query(`
      UPDATE connection_plans SET proposer_id = $2, proposed_at = $3, revision = revision + 1
      WHERE id = $1 RETURNING ${planFields}
    `, [id, userId, proposedAt]));
  }
  return [200, rows[0]];
}));

module.exports = router;
