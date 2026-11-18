const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { audit, safeError } = require('../management');
const { notifyActivity } = require('../messageAlerts');

const router = express.Router();
const adminRouter = express.Router();
const reminderBatchSize = 50;
const isId = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
const sessionFields = `s.id, s.title, s.mode, s.starts_at, s.ends_at, (s.starts_at <= now()) AS live`;

router.use(authenticate, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/', async (req, res, next) => {
  const requestedSession = Number(req.query.session);
  try {
    const { rows } = await db.query(`SELECT ${sessionFields}, (r.user_id IS NOT NULL) AS reminded
      FROM meet_sessions s LEFT JOIN meet_session_reminders r ON r.session_id=s.id AND r.user_id=$1
      WHERE s.cancelled_at IS NULL AND s.ends_at > now()
      ORDER BY (s.id = $2) DESC NULLS LAST, s.starts_at, s.id LIMIT 50`,
    [req.user.userId, isId(requestedSession) ? requestedSession : null]);
    res.json({ sessions: rows });
  } catch (error) { next(error); }
});

router.put('/:id/reminder', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!isId(id)) return res.sendStatus(404);
  try {
    const { rows } = await db.query(`WITH upcoming AS (
        SELECT id FROM meet_sessions WHERE id=$1 AND cancelled_at IS NULL AND starts_at > now()
      ), saved AS (
        INSERT INTO meet_session_reminders (session_id, user_id) SELECT id, $2 FROM upcoming
        ON CONFLICT DO NOTHING RETURNING session_id
      ) SELECT id FROM upcoming`, [id, req.user.userId]);
    if (!rows.length) return res.status(409).json({ error: 'This session is no longer accepting reminders.' });
    res.sendStatus(204);
  } catch (error) { next(error); }
});

router.delete('/:id/reminder', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!isId(id)) return res.sendStatus(404);
  try {
    await db.query(`DELETE FROM meet_session_reminders
      WHERE session_id=$1 AND user_id=$2 AND notified_at IS NULL`, [id, req.user.userId]);
    res.sendStatus(204);
  } catch (error) { next(error); }
});

async function transaction(work) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

adminRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

adminRouter.get('/', async (_req, res) => {
  try {
    const { rows } = await db.query(`SELECT ${sessionFields} FROM meet_sessions s
      WHERE s.cancelled_at IS NULL AND s.ends_at > now() ORDER BY s.starts_at, s.id`);
    res.json({ sessions: rows });
  } catch (error) { safeError(res, error); }
});

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? date : null;
}

adminRouter.post('/', async (req, res) => {
  const { title: input, mode, startsAt, endsAt } = req.body || {};
  const title = typeof input === 'string' ? input.trim() : '';
  const start = parseDate(startsAt);
  const end = parseDate(endsAt);
  if (!title || title.length > 80 || !['chat', 'call'].includes(mode) || !start || !end || end <= start) {
    return res.status(400).json({ error: 'Enter a title, a session type, and an end time after the start.' });
  }
  try {
    const session = await transaction(async client => {
      const { rows: [row] } = await client.query(`INSERT INTO meet_sessions (title, mode, starts_at, ends_at, created_by)
        SELECT $1, $2, $3, $4, $5 WHERE $3::timestamptz > now()
        RETURNING id, title, mode, starts_at, ends_at, FALSE AS live`, [title, mode, start, end, req.actor.id]);
      if (row) await audit(client, req.actor, 'meet_session_scheduled', 'meet_session', row.id, 'Scheduled a Meet session', row);
      return row;
    });
    if (!session) return res.status(400).json({ error: 'Choose a start time in the future.' });
    res.status(201).json(session);
  } catch (error) { safeError(res, error); }
});

adminRouter.post('/:id/cancel', async (req, res) => {
  const id = Number(req.params.id);
  if (!isId(id)) return res.sendStatus(404);
  try {
    const cancelled = await transaction(async client => {
      const { rowCount } = await client.query(`UPDATE meet_sessions SET cancelled_at=now()
        WHERE id=$1 AND cancelled_at IS NULL AND starts_at > now()`, [id]);
      if (rowCount) await audit(client, req.actor, 'meet_session_cancelled', 'meet_session', id, 'Cancelled a scheduled Meet session');
      return rowCount > 0;
    });
    if (!cancelled) return res.status(409).json({ error: 'This session is no longer upcoming.' });
    res.sendStatus(204);
  } catch (error) { safeError(res, error); }
});

async function claimDueMeetReminders() {
  const { rows } = await db.query(`WITH due AS (
      SELECT r.session_id, r.user_id, s.title FROM meet_session_reminders r
      JOIN meet_sessions s ON s.id=r.session_id JOIN users u ON u.id=r.user_id
      WHERE r.notified_at IS NULL AND s.cancelled_at IS NULL
        AND s.starts_at <= now() AND s.ends_at > now() AND u.banned_at IS NULL
      ORDER BY s.starts_at, r.session_id, r.user_id LIMIT $1 FOR UPDATE OF r SKIP LOCKED
    ) UPDATE meet_session_reminders r SET notified_at=now()
      FROM due WHERE r.session_id=due.session_id AND r.user_id=due.user_id
      RETURNING r.session_id, r.user_id, due.title`, [reminderBatchSize]);
  return rows;
}

function startMeetReminders(io) {
  let running = false;
  async function dispatch() {
    if (running) return;
    running = true;
    try {
      let batch;
      do {
        batch = await claimDueMeetReminders();
        const deliveries = await Promise.allSettled(batch.map(({ session_id, user_id, title }) =>
          notifyActivity(io, user_id, null, {
            path: `/aura-chat?session=${session_id}`,
            body: `${title} is live. Open Meet to join.`
          })
        ));
        for (const result of deliveries) {
          if (result.status === 'rejected') console.error('Meet reminder delivery failed:', result.reason?.code || result.reason?.name);
        }
      } while (batch.length === reminderBatchSize);
    } catch (error) {
      console.error('Meet reminders unavailable:', error.code || error.name);
    } finally {
      running = false;
    }
  }
  void dispatch();
  const timer = setInterval(dispatch, 15000);
  timer.unref();
}

module.exports = { router, adminRouter, startMeetReminders, claimDueMeetReminders };
