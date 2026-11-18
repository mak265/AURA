const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const db = require('../../src/db');

const schema = 'meet_sessions_test_' + randomBytes(8).toString('hex');
const originalPool = db.pool;
const originalQuery = db.query;
let pool;
let server;
let baseUrl;
let meet;

before(async () => {
  process.env.JWT_SECRET = 'meet-local-test-secret';
  await originalPool.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  db.pool = pool;
  db.query = (sql, params) => pool.query(sql, params);
  await pool.query(`CREATE TABLE users (
      id INTEGER PRIMARY KEY, email TEXT, management_role TEXT, banned_at TIMESTAMPTZ,
      auth_version INTEGER DEFAULT 0, must_change_password BOOLEAN DEFAULT FALSE, admin_restricted_until TIMESTAMPTZ
    );
    INSERT INTO users (id, email, management_role) VALUES
      (1, 'member@example.test', 'user'), (2, 'host@example.test', 'staff'), (3, 'other@example.test', 'user'),
      (4, 'owner@example.test', 'superadmin');
    CREATE TABLE management_audit (
      actor_id INTEGER, actor_email TEXT, action TEXT, target_type TEXT, target_id INTEGER, reason TEXT, changes JSONB
    );
    CREATE TABLE account_sessions (user_id INTEGER, session_id UUID, revoked_at TIMESTAMPTZ);`);
  const migration = path.join(__dirname, '../../db/migrations/041_meet_sessions.sql');
  await pool.query(readFileSync(migration, 'utf8'));
  const app = express();
  app.use(express.json());
  meet = require('../../src/routes/meetSessions');
  app.use('/meet-sessions', meet.router);
  app.use('/admin', require('../../src/routes/admin'));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  db.pool = originalPool;
  db.query = originalQuery;
  if (pool) {
    await pool.end();
    await originalPool.query(`DROP SCHEMA ${schema} CASCADE`);
  }
  await originalPool.end();
});

const call = (userId, pathname, method = 'GET', data) => fetch(`${baseUrl}${pathname}`, {
  method,
  headers: {
    Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET)}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(data)
});

test('staff schedule real sessions and reminders belong to the member who opts in', async () => {
  const schedule = {
    title: 'Evening voice Meet', mode: 'call',
    startsAt: new Date(Date.now() + 600000).toISOString(), endsAt: new Date(Date.now() + 1200000).toISOString()
  };
  assert.equal((await call(1, '/admin/meet-sessions', 'POST', schedule)).status, 403);
  assert.equal((await call(4, '/admin/meet-sessions', 'POST', schedule)).status, 403);
  assert.equal((await call(2, '/admin/meet-sessions', 'POST', { ...schedule, endsAt: schedule.startsAt })).status, 400);
  const created = await call(2, '/admin/meet-sessions', 'POST', schedule);
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const endpoint = `/meet-sessions/${id}/reminder`;
  assert.equal((await call(1, endpoint, 'PUT')).status, 204);
  assert.equal((await call(1, endpoint, 'PUT')).status, 204);
  const readSessions = async user => (await (await call(user, '/meet-sessions')).json()).sessions;
  assert.equal((await readSessions(1)).find(session => session.id === id).reminded, true);
  assert.equal((await readSessions(3)).find(session => session.id === id).reminded, false);
  assert.equal((await call(1, endpoint, 'DELETE')).status, 204);
  assert.equal((await readSessions(1)).find(session => session.id === id).reminded, false);
  assert.equal((await call(2, `/admin/meet-sessions/${id}/cancel`, 'POST')).status, 204);
  assert.equal((await call(1, endpoint, 'PUT')).status, 409);
  assert.equal((await readSessions(1)).some(session => session.id === id), false);
});

test('concurrent reminder processing records a delivery once and only while the session is live', async () => {
  const { rows } = await pool.query(`INSERT INTO meet_sessions (title, mode, starts_at, ends_at) VALUES
    ('Live', 'chat', NOW() - INTERVAL '1 minute', NOW() + INTERVAL '5 minutes'),
    ('Upcoming', 'chat', NOW() + INTERVAL '1 minute', NOW() + INTERVAL '5 minutes'),
    ('Ended', 'call', NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '1 minute')
    RETURNING id`);
  const ids = rows.map(row => row.id);
  await pool.query('INSERT INTO meet_session_reminders (session_id, user_id) SELECT unnest($1::int[]), 1', [ids]);
  const claim = await Promise.all([meet.claimDueMeetReminders(), meet.claimDueMeetReminders()]);
  assert.deepEqual(claim.flat().map(row => row.session_id), [ids[0]]);
  const activity = await pool.query('SELECT session_id FROM meet_session_reminders WHERE notified_at IS NOT NULL');
  assert.deepEqual(activity.rows.map(row => row.session_id), [ids[0]]);
});
