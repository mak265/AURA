const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const db = require('../src/db');
process.env.JWT_SECRET = 'local-auth-test-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
let unavailable = false;
let newAccount = false, insertValues;
const user = { id: 1, email: 'test@example.com', password_hash: bcrypt.hashSync('valid-password', 4) };
db.query = async (sql, values) => {
  if (unavailable) throw Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' });
  if (sql.includes('INSERT INTO users')) { insertValues = values; return {rows:[user]}; }
  if (newAccount && sql.includes('FROM users')) return {rows:[]};
  return { rows: sql.includes('FROM users') ? [user] : [{ aura_name: 'Moon' }] };
};
OAuth2Client.prototype.verifyIdToken = async ({ idToken, audience }) => {
  assert.equal(audience, process.env.GOOGLE_CLIENT_ID);
  if (idToken !== 'verified-test-token') throw new Error('Invalid token');
  return { getPayload: () => ({ email: user.email, name: 'Test Person' }) };
};
const app = express();
app.use(express.json());
app.use(require('../src/routes/auth'));
const server = app.listen(0, '127.0.0.1');
const ready = new Promise(resolve => server.once('listening', resolve));
async function post(path, body) {
  await ready;
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
after(() => new Promise(resolve => server.close(resolve)));
test('password login accepts a valid password and rejects an incorrect one', async () => {
  assert.equal((await post('/login', { email: user.email, password: 'valid-password' })).status, 200);
  assert.equal((await post('/login', { email: user.email, password: 'incorrect' })).status, 401);
});
test('Google login completes after token verification; invalid tokens are rejected', async () => {
  const result = await post('/google', { tokenId: 'verified-test-token' });
  assert.equal(result.status, 200);
  assert.equal(result.body.user.hasAura, true);
  assert.ok(result.body.token);
  assert.equal((await post('/google', { tokenId: 'invalid' })).status, 401);
});
test('both login methods report database outages as temporary unavailability', async () => {
  unavailable = true;
  try {
    for (const [path, body] of [['/login', { email: user.email, password: 'valid-password' }], ['/google', { tokenId: 'verified-test-token' }]]) {
      const result = await post(path, body);
      assert.equal(result.status, 503);
      assert.match(result.body.error, /temporarily unavailable/);
    }
  } finally { unavailable = false; }
});

test('banned accounts cannot sign in through password or Google',async()=>{
 user.banned_at=new Date().toISOString();
 try{assert.equal((await post('/login',{email:user.email,password:'valid-password'})).status,403);assert.equal((await post('/google',{tokenId:'verified-test-token'})).status,403);}finally{delete user.banned_at;}
});

const consent={version:require('../src/policies.json').version,terms:true,privacy:true,adult:true};
test('email signup requires complete current policy consent and stores the accepted version',async()=>{
 const body={email:user.email,password:'valid-password',confirmPassword:'valid-password'};
 newAccount=true;
 try{
  for(const policyConsent of [undefined,{...consent,adult:false},{...consent,privacy:false},{...consent,terms:false},{...consent,version:'old'},{...consent,adult:'true'}]){
   insertValues=undefined;
   assert.equal((await post('/signup',{...body,policyConsent})).status,428);
   assert.equal(insertValues,undefined);
  }
  assert.equal((await post('/signup',{...body,policyConsent:consent})).status,201);
  assert.equal(insertValues[2],consent.version);
 }finally{newAccount=false;}
});
test('new Google accounts require consent while existing Google login remains available',async()=>{
 newAccount=true;insertValues=undefined;
 try{
  assert.equal((await post('/google',{tokenId:'verified-test-token'})).status,428);
  assert.equal(insertValues,undefined);
  assert.equal((await post('/google',{tokenId:'verified-test-token',policyConsent:consent})).status,200);
  assert.equal(insertValues[3],consent.version);
 }finally{newAccount=false;}
 assert.equal((await post('/google',{tokenId:'verified-test-token'})).status,200);
});
