const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../src/db');
const calls = [];
// Profile unit tests stub moderation; real enforcement is covered by integration tests.
require('../src/textModeration').enforceText = async () => true;
db.query = async (sql, params) => {
  calls.push({ sql, params });
  if (sql.includes('SELECT user_id FROM auras')) return { rows: [{ user_id: 1 }] };
  if (sql.includes('FROM users u')) return { rows: [{ id: 2, dating_intention: 'Serious relationship', prompt_answers: ['Coffee', '', ''], aura_name: 'Moon' }] };
  return { rows: [] };
};
require('../src/middleware/auth').authenticate = (req, res, next) => { req.user = { userId: 1 }; next(); };
const app = express();
app.use(express.json());
app.use('/aura', require('../src/routes/aura'));
app.use('/profile', require('../src/routes/profile'));
app.use('/discover', require('../src/routes/discover'));
const server = app.listen(0, '127.0.0.1');
const ready = new Promise(resolve => server.once('listening', resolve));
async function request(path, body) {
  await ready;
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, body ? { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return { status: response.status, body: await response.json() };
}
after(() => new Promise(resolve => server.close(resolve)));
test('invalid public profile fields are rejected before writes on both update routes', async () => {
  for (const route of ['/aura', '/profile']) for (const invalid of [{ dating_intention: 'invalid' }, { prompt_answers: ['one'] }, { prompt_answers: ['a'.repeat(201), '', ''] }, { prompt_answers: [null, '', ''] }]) {
    calls.length = 0;
    assert.equal((await request(route, invalid)).status, 400);
    assert.equal(calls.length, 0);
  }
});
test('profile answers are trimmed, saved, and can be cleared on both routes', async () => {
  for (const route of ['/aura', '/profile']) for (const intention of ['Serious relationship', '']) {
    calls.length = 0;
    assert.equal((await request(route, { aura_name: 'Moon', dating_intention: intention, prompt_answers: [' Coffee ', '', ''] })).status, 200);
    const saved = calls.find(c => c.sql.includes('SET dating_intention'));
    assert.deepEqual(saved.params, [intention, JSON.stringify(['Coffee', '', '']), 1]);
  }
});
test('old clients preserve connection fields when omitted', async () => {
  calls.length = 0;
  assert.equal((await request('/aura', { aura_name: 'Moon' })).status, 200);
  assert.equal(calls.some(c => c.sql.includes('SET dating_intention')), false);
});
test('Discover uses a parameterized intention filter and returns only public fields', async () => {
  calls.length = 0;
  const response = await request('/discover?dating_intention=Serious%20relationship');
  assert.equal(response.status, 200);
  const query = calls.find(c => c.sql.includes('FROM users u'));
  assert.ok(query.sql.includes('a.dating_intention = $3'));
  assert.equal(query.params[2], 'Serious relationship');
  assert.equal(response.body[0].dating_intention, 'Serious relationship');
  assert.deepEqual(response.body[0].prompt_answers, ['Coffee', '', '']);
  assert.equal('email' in response.body[0], false);
  assert.equal('real_name' in response.body[0], false);
});


