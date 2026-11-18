const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const db = require('../../src/db');

const originalPool = db.pool;
const originalQuery = db.query;
const schema = 'connection_plans_test_' + randomBytes(6).toString('hex');
let pool, server, base;

before(async () => {
  await originalPool.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  db.pool = pool;
  db.query = (sql, params) => pool.query(sql, params);
  const dbPath = path.join(__dirname, '../../db');
  await pool.query(fs.readFileSync(path.join(dbPath, 'schema.sql'), 'utf8').replace(/^DROP TABLE .*;\r?$/gm, ''));
  const migrations = path.join(dbPath, 'migrations');
  for (const file of fs.readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    await pool.query(fs.readFileSync(path.join(migrations, file), 'utf8'));
  }
  await pool.query(`
    INSERT INTO users(id, email, password_hash)
    SELECT id, 'plan' || id || '@example.com', 'test' FROM generate_series(1, 5) id;
    INSERT INTO matches(id, user1_id, user2_id, soul_game_completed, revealed) VALUES
      (1, 1, 2, true, true), (2, 1, 3, true, false), (3, 1, 4, false, true),
      (4, 2, 3, true, true), (5, 2, 4, true, true), (6, 1, 5, true, true);
    INSERT INTO blocks(blocker_id, blocked_id) VALUES (3, 2);
    UPDATE users SET banned_at = NOW() WHERE id = 5;
  `);
  const app = express();
  app.use(express.json());
  app.use('/matches', require('../../src/routes/matches'));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  db.pool = originalPool;
  db.query = originalQuery;
  if (pool) await pool.end();
  await originalPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await originalPool.end();
});

function future(hours) {
  return new Date(Date.now() + hours * 3600000).toISOString();
}

async function request(user, match, suffix = '', method = 'GET', payload = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = 'Bearer ' + jwt.sign({ userId: user }, process.env.JWT_SECRET);
  const response = await fetch(`${base}/matches/${match}/plans${suffix}`, {
    method, headers, body: payload ? JSON.stringify(payload) : undefined,
  });
  return {
    status: response.status,
    body: response.headers.get('content-type')?.includes('application/json') ? await response.json() : null,
  };
}

function proposal(type = 'call', proposedAt = future(2)) {
  return { type, proposedAt, clientPlanId: randomUUID() };
}

test('both revealed participants see plans, while ineligible accounts and matches cannot access them', async () => {
  assert.equal((await request(1, 1)).status, 200);
  assert.equal((await request(2, 1)).status, 200);
  assert.equal((await request(null, 1)).status, 401);
  for (const [user, match] of [[3, 1], [1, 2], [1, 3], [2, 4], [3, 4], [1, 6]]) {
    assert.equal((await request(user, match)).status, 404);
    assert.equal((await request(user, match, '', 'POST', proposal())).status, 404);
  }
});

test('only the other participant can respond, and the accepted counterproposal survives reload', async () => {
  const original = proposal('meetup');
  const posted = await request(1, 1, '', 'POST', original);
  assert.equal(posted.status, 201);
  const plan = posted.body;
  assert.equal(plan.type, 'meetup');
  assert.equal(plan.proposed_at, original.proposedAt);
  assert.ok((await request(2, 1)).body.some(row => row.id === plan.id));
  assert.equal((await request(1, 1, `/${plan.id}`, 'PATCH', { action: 'accept', revision: plan.revision })).status, 403);
  assert.equal((await request(2, 5, `/${plan.id}`, 'PATCH', { action: 'accept', revision: plan.revision })).status, 404);

  const proposedAt = future(4);
  const counter = await request(2, 1, `/${plan.id}`, 'PATCH', { action: 'suggest', proposedAt, revision: plan.revision });
  assert.equal(counter.status, 200);
  assert.equal(counter.body.proposer_id, 2);
  assert.equal(counter.body.agreed_at, null);
  assert.equal((await request(1, 1, `/${plan.id}`, 'PATCH', { action: 'accept', revision: plan.revision })).status, 409);
  const accepted = await request(1, 1, `/${plan.id}`, 'PATCH', { action: 'accept', revision: counter.body.revision });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.agreed_at, proposedAt);
  for (const user of [1, 2]) {
    const stored = (await request(user, 1)).body.find(row => row.id === plan.id);
    assert.equal(stored.agreed_at, proposedAt);
  }
  assert.equal((await request(2, 1, `/${plan.id}`, 'PATCH', { action: 'suggest', proposedAt: future(5), revision: accepted.body.revision })).status, 409);
});

test('plans reject unsupported types, invalid dates and dates in the past', async () => {
  for (const invalid of [proposal('video'), proposal('call', 'tomorrow'), proposal('call', future(-2)),
    proposal('call', '2099-02-30T12:00:00.000Z')]) {
    assert.equal((await request(1, 1, '', 'POST', invalid)).status, 400);
  }
  const { body: plan } = await request(1, 1, '', 'POST', proposal());
  assert.equal((await request(2, 1, `/${plan.id}`, 'PATCH', {
    action: 'suggest', proposedAt: future(-1), revision: plan.revision,
  })).status, 400);
  await pool.query("UPDATE connection_plans SET proposed_at = NOW() - interval '1 minute' WHERE id = $1", [plan.id]);
  assert.equal((await request(2, 1, `/${plan.id}`, 'PATCH', { action: 'accept', revision: plan.revision })).status, 409);
});

test('sending the same proposal twice creates one card and concurrent responses advance only one revision', async () => {
  const original = proposal();
  const submissions = await Promise.all([
    request(1, 1, '', 'POST', original),
    request(1, 1, '', 'POST', original),
  ]);
  assert.deepEqual(submissions.map(result => result.status).sort(), [200, 201]);
  const [first, second] = submissions.map(result => result.body);
  assert.equal(first.id, second.id);
  const endpoint = `/${first.id}`;
  const responses = await Promise.all([
    request(2, 1, endpoint, 'PATCH', { action: 'accept', revision: first.revision }),
    request(2, 1, endpoint, 'PATCH', { action: 'suggest', proposedAt: future(4), revision: first.revision }),
  ]);
  assert.deepEqual(responses.map(result => result.status).sort(), [200, 409]);
});
