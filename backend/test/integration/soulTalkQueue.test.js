const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const db = require('../../src/db');
const { startSearch, heartbeat } = require('../../src/soulTalkQueue');
const {Server}=require('socket.io');
// Use the same Socket.IO client dependency as the frontend for this full-stack test.
const {io:connectClient}=require('../../../frontend/node_modules/socket.io-client');
const {authorizeChannel,registerConversationSocket}=require('../../src/conversationSocket');
const originalPool = db.pool;
const originalQuery = db.query;
const schema = 'soul_queue_test_' + crypto.randomBytes(8).toString('hex');
let pool;
let server;
let baseUrl;
let realtime;
before(async () => {
  await originalPool.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  db.pool = pool;
  db.query = (sql, params) => pool.query(sql, params);
  await pool.query(`CREATE TABLE users (id integer PRIMARY KEY, real_name text, profile_photo text, age integer, gender text, city text, religion text, email text, settings jsonb, credits integer DEFAULT 0);
    INSERT INTO users(id) SELECT generate_series(1,8);
    CREATE TABLE auras (user_id integer, aura_name text, aura_color text, vibe text, bio text, emoji text, dating_intention text, prompt_answers jsonb);
    INSERT INTO auras(user_id,aura_name,prompt_answers) SELECT id,'Aura '||id,'[]'::jsonb FROM users;
    CREATE TABLE matches (id serial PRIMARY KEY, user1_id integer, user2_id integer, soul_game_completed boolean DEFAULT FALSE, revealed boolean DEFAULT FALSE);
    CREATE TABLE likes(sender_id integer,receiver_id integer);
    CREATE TABLE aura_requests(sender_id integer,receiver_id integer,status text);
    CREATE TABLE aura_session_answers (id serial PRIMARY KEY,session_id integer,user_id integer,round integer,answer text);
    CREATE TABLE aura_session_messages (id serial PRIMARY KEY,session_id integer,sender_id integer,content text,created_at timestamptz DEFAULT NOW(),delivered_at timestamptz,read_at timestamptz);
    CREATE TABLE messages (id serial PRIMARY KEY,match_id integer,sender_id integer,content text,created_at timestamptz DEFAULT NOW(),delivered_at timestamptz,read_at timestamptz,kind text DEFAULT 'text',attachment bytea,attachment_mime text,duration_seconds real);
    CREATE TABLE post_likes (post_id integer,user_id integer);
    CREATE TABLE post_comments (post_id integer,user_id integer);
    CREATE TABLE interests (id integer,name text,emoji text);
    CREATE TABLE user_interests (user_id integer,interest_id integer);
    CREATE TABLE posts (id serial PRIMARY KEY,user_id integer,image_url text,caption text,created_at timestamptz DEFAULT NOW(),visibility text DEFAULT 'public');
    CREATE TABLE blocks (id serial PRIMARY KEY,blocker_id integer, blocked_id integer);
    CREATE TABLE aura_sessions (id serial PRIMARY KEY, user1_id integer, user2_id integer,
      status text, requested_partner_id integer, search_expires_at timestamptz, created_at timestamptz DEFAULT NOW());`);
  await pool.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../db/migrations/009_active_status.sql'),'utf8'));
  await pool.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../db/migrations/010_conversation_actions.sql'),'utf8'));
  await pool.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../db/migrations/015_text_moderation.sql'),'utf8'));
  for(const file of ['011_message_reactions.sql','012_message_removal.sql'])await pool.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../db/migrations',file),'utf8'));
  for(const file of ['016_safety_reports.sql','017_admin_management.sql','018_report_evidence_retention.sql','020_aura_farming.sql'])await pool.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../db/migrations',file),'utf8'));
  const app = express();
  app.use(express.json());
  app.use('/profile',require('../../src/routes/profile'));
  app.use('/matches',require('../../src/routes/matches'));
  app.use(require('../../src/routes/auraChat'));
  server = app.listen(0, '127.0.0.1');
  realtime=new Server(server);
  realtime.use((socket,next)=>{try{const decoded=jwt.verify(socket.handshake.auth.token,process.env.JWT_SECRET);socket.userId=decoded.userId;socket.authVersion=decoded.version||0;next();}catch{next(new Error('Unauthorized'));}});
  realtime.on('connection',registerConversationSocket);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
});
beforeEach(async () => { await pool.query('TRUNCATE farming_signals, farming_usage, report_message_evidence, safety_reports, account_warnings, daily_app_usage, moderation_state, hidden_messages, message_reactions, conversation_preferences, aura_sessions, matches, blocks, aura_session_answers, aura_session_messages, messages, likes, aura_requests'); await pool.query("UPDATE users SET settings='{}'::jsonb,premium_until=NULL,age=NULL,gender=NULL,religion=NULL"); });
after(async () => {
  if(realtime)await new Promise(resolve=>realtime.close(resolve));
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  db.pool = originalPool;
  db.query = originalQuery;
  if (pool) await pool.end();
  await originalPool.query(`DROP SCHEMA ${schema} CASCADE`);
  await originalPool.end();
});
const session = async id => (await pool.query('SELECT * FROM aura_sessions WHERE id=$1', [id])).rows[0];
test('one search never pulls an idle user into a conversation', async () => {
  const id = await startSearch(1);
  assert.equal((await session(id)).status, 'waiting');
  assert.equal((await session(id)).user2_id, null);
});
test('two live searches pair once and start the five-minute timer at pairing', async () => {
  const id = await startSearch(1);
  await pool.query("UPDATE aura_sessions SET created_at=NOW()-INTERVAL '2 minutes' WHERE id=$1",[id]);
  assert.equal(await startSearch(2), id);
  const result = await session(id);
  assert.equal(result.status, 'active');
  assert.equal(result.user2_id, 2);
  assert.ok(Date.now() - new Date(result.created_at).getTime() < 5000);
  assert.equal(result.search_expires_at, null);
});
test('cancelled and abandoned searches cannot be paired or revived by delayed heartbeats', async () => {
  const cancelled = await startSearch(1);
  await pool.query("UPDATE aura_sessions SET status='ended' WHERE id=$1",[cancelled]);
  const abandoned = await startSearch(2);
  await pool.query("UPDATE aura_sessions SET search_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[abandoned]);
  await heartbeat(abandoned, 2);
  const next = await startSearch(3);
  assert.notEqual(next, cancelled);
  assert.notEqual(next, abandoned);
  assert.equal((await session(next)).status, 'waiting');
  assert.equal((await session(abandoned)).status, 'ended');
});
test('heartbeats renew only the waiting search owner lease', async () => {
  const id = await startSearch(1);
  await pool.query("UPDATE aura_sessions SET search_expires_at=NOW()+INTERVAL '2 seconds' WHERE id=$1",[id]);
  const previous = (await session(id)).search_expires_at;
  await heartbeat(id, 2);
  assert.equal(+(await session(id)).search_expires_at, +previous);
  await heartbeat(id, 1);
  assert.ok(+(await session(id)).search_expires_at > +previous);
});
test('match-specific Soul Talk requires reciprocal searches and excludes the random queue', async () => {
  await pool.query('INSERT INTO matches(user1_id,user2_id) VALUES(1,2)');
  const directed = await startSearch(1, 2);
  assert.equal((await session(directed)).status, 'waiting');
  const random = await startSearch(3);
  assert.notEqual(random, directed);
  assert.equal(await startSearch(2, 1), directed);
  assert.equal((await session(directed)).status, 'active');
  assert.equal((await session(random)).status, 'waiting');
});
test('concurrent joins and duplicate starts never put one person into two active sessions', async () => {
  const ids = await Promise.all([startSearch(1),startSearch(2),startSearch(3),startSearch(1)]);
  assert.ok(ids.every(Number.isInteger));
  const {rows} = await pool.query("SELECT * FROM aura_sessions WHERE status IN ('active','waiting')");
  assert.equal(rows.filter(row=>row.status==='active').length,1);
  assert.equal(rows.filter(row=>row.status==='waiting').length,1);
  const participants = rows.flatMap(row=>[row.user1_id,row.user2_id].filter(Boolean));
  assert.equal(new Set(participants).size, participants.length);
});
test('blocked users cannot pair even when both are searching', async () => {
  await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(1,2)');
  const a = await startSearch(1);
  const b = await startSearch(2);
  assert.notEqual(a,b);
  assert.equal((await session(a)).status,'waiting');
  assert.equal((await session(b)).status,'waiting');
});

async function request(userId, path, body) {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET);
  const response = await fetch(baseUrl + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

const socketEvent=(socket,name)=>new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{socket.off(name,done);reject(new Error('Timed out waiting for '+name));},2000);
 const done=value=>{clearTimeout(timer);resolve(value);};socket.once(name,done);
});
async function socketFor(userId){
 const socket=connectClient(baseUrl,{auth:{token:jwt.sign({userId},process.env.JWT_SECRET)},transports:['websocket'],forceNew:true,reconnection:false});
 await socketEvent(socket,'connect');return socket;
}
const joinSocket=(socket,event,payload)=>new Promise(resolve=>socket.timeout(2000).emit(event,payload,(error,result)=>resolve(error?{ok:false}:result)));
test('real sockets deliver typing and stop events only to the other conversation participant',async()=>{
 const match=(await pool.query('INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES(1,2,TRUE) RETURNING id')).rows[0].id;
 const sockets=await Promise.all([socketFor(1),socketFor(2),socketFor(3)]),[a,b,outsider]=sockets;
 try{
  assert.equal((await joinSocket(a,'join:match',{matchId:match})).ok,true);
  assert.equal((await joinSocket(b,'join:match',{matchId:match})).ok,true);
  assert.equal((await joinSocket(outsider,'join:match',{matchId:match})).ok,false);
  let own=0,foreign=0;a.on('typing',()=>own++);outsider.on('typing',()=>foreign++);
  const event=socketEvent(b,'typing');a.emit('typing',{kind:'match',id:match,typing:true,userId:3});
  assert.deepEqual(await event,{kind:'match',id:match,userId:1,typing:true});
  const stop=socketEvent(b,'typing');a.emit('typing',{kind:'match',id:match,typing:false});assert.equal((await stop).typing,false);
  assert.equal(own,0);assert.equal(foreign,0);
  const disconnect=socketEvent(b,'typing');a.disconnect();assert.equal((await disconnect).typing,false);
 }finally{sockets.forEach(s=>s.disconnect());}
});
test('anonymous typing permits active chat members, denies waiting/call/ended sessions and rechecks blocks and token versions',async()=>{
 const id=await startSearch(1);
 const socket={userId:1,authVersion:0};
 assert.equal(await authorizeChannel(socket,{kind:'aura',id}),false);
 await startSearch(2);
 const a=await socketFor(1),b=await socketFor(2);
 try{
  assert.equal((await joinSocket(a,'join:aura',{sessionId:id})).ok,true);assert.equal((await joinSocket(b,'join:aura',{sessionId:id})).ok,true);
  const event=socketEvent(b,'typing');a.emit('typing',{kind:'aura',id,typing:true});assert.equal((await event).userId,1);
  await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(1,2)');assert.equal(await authorizeChannel(socket,{kind:'aura',id}),false);
  await pool.query('TRUNCATE blocks');await pool.query('UPDATE users SET auth_version=1 WHERE id=1');assert.equal(await authorizeChannel(socket,{kind:'aura',id}),false);
  await pool.query('UPDATE users SET auth_version=0 WHERE id=1');
  await pool.query("UPDATE aura_sessions SET mode='call' WHERE id=$1",[id]);assert.equal(await authorizeChannel(socket,{kind:'aura',id}),false);
  await pool.query("UPDATE aura_sessions SET mode='chat',status='ended' WHERE id=$1",[id]);assert.equal(await authorizeChannel(socket,{kind:'aura',id}),false);
 }finally{a.disconnect();b.disconnect();await pool.query('UPDATE users SET auth_version=0 WHERE id=1');}
});

test('Farming separates queues and charges both people only once on successful pairing',async()=>{
 const chat=await startSearch(1),call=await startSearch(2,null,{mode:'call'});
 assert.notEqual(chat,call);assert.equal((await pool.query('SELECT * FROM farming_usage')).rowCount,0);
 assert.equal(await startSearch(3,null,{mode:'call'}),call);
 assert.equal((await session(chat)).status,'waiting');
 await startSearch(2,null,{mode:'call'});
 for(const id of [2,3])assert.equal((await pool.query('SELECT calls FROM farming_usage WHERE user_id=$1',[id])).rows[0].calls,1);
});
test('free age and gender filters are reciprocal and unknown ages do not match a range',async()=>{
 await pool.query("UPDATE users SET age=25,gender='Female' WHERE id=1");
 await pool.query("UPDATE users SET age=28,gender='Male' WHERE id=2");
 const a=await startSearch(1,null,{filters:{ageMin:24,ageMax:30,gender:'Male'}});
 const b=await startSearch(2,null,{filters:{gender:'Male'}});assert.notEqual(a,b);
 assert.notEqual(await startSearch(3),a);
 assert.equal(await startSearch(2,null,{filters:{gender:'Female',ageMin:20,ageMax:26}}),a);
});
test('religion is premium-only and queued religion filters remain enforced',async()=>{
 await assert.rejects(startSearch(1,null,{filters:{religion:'Catholic'}}),e=>e.code==='PREMIUM_REQUIRED');
 await pool.query("UPDATE users SET premium_until=NOW()+INTERVAL '1 day',religion='Catholic' WHERE id=1");
 await pool.query("UPDATE users SET religion='Muslim' WHERE id=2");
 const a=await startSearch(1,null,{filters:{religion:'Catholic'}});
 assert.notEqual(await startSearch(2),a);
 await pool.query("UPDATE users SET religion='Catholic' WHERE id=3");
 assert.equal(await startSearch(3),a);
});
test('five chats and three calls are independent and reset in a fixed 24-hour window',async()=>{
 await pool.query('INSERT INTO farming_usage(user_id,chats,calls) VALUES(1,5,2)');
 await assert.rejects(startSearch(1),e=>e.code==='DAILY_LIMIT');
 const call=await startSearch(1,null,{mode:'call'});await startSearch(2,null,{mode:'call'});
 await pool.query("UPDATE aura_sessions SET status='ended' WHERE id=$1",[call]);
 await assert.rejects(startSearch(1,null,{mode:'call'}),e=>e.code==='DAILY_LIMIT');
 const before=(await pool.query('SELECT window_started_at FROM farming_usage WHERE user_id=1')).rows[0].window_started_at;
 await assert.rejects(startSearch(1),e=>e.code==='DAILY_LIMIT');
 assert.equal(+(await pool.query('SELECT window_started_at FROM farming_usage WHERE user_id=1')).rows[0].window_started_at,+before);
 await pool.query("UPDATE farming_usage SET window_started_at=NOW()-INTERVAL '24 hours' WHERE user_id=1");
 const chat=await startSearch(1);assert.equal(await startSearch(3),chat);
 const usage=(await pool.query('SELECT * FROM farming_usage WHERE user_id=1')).rows[0];assert.equal(usage.chats,1);assert.equal(usage.calls,0);
});
test('premium bypasses quota but expired premium cannot pair queued religion searches',async()=>{
 await pool.query("UPDATE users SET premium_until=NOW()+INTERVAL '1 day',religion='Catholic' WHERE id IN(1,2)");
 await pool.query('INSERT INTO farming_usage(user_id,chats,calls) VALUES(1,99,99)');
 const a=await startSearch(1,null,{filters:{religion:'Catholic'}});
 await pool.query("UPDATE users SET premium_until=NOW()-INTERVAL '1 second' WHERE id=1");
 assert.notEqual(await startSearch(2),a);
 await assert.rejects(startSearch(1,null,{filters:{religion:'Catholic'}}),e=>e.code==='PREMIUM_REQUIRED');
 await assert.rejects(startSearch(1),e=>e.code==='DAILY_LIMIT');
});
test('concurrent joins cannot overspend; exhausted waiting owners are skipped',async()=>{
 const a=await startSearch(1);
 const ids=await Promise.all([startSearch(2),startSearch(2),startSearch(2)]);assert.ok(ids.every(id=>id===a));
 assert.equal((await pool.query('SELECT chats FROM farming_usage WHERE user_id=2')).rows[0].chats,1);
 await pool.query("UPDATE aura_sessions SET status='ended'");
 const wait=await startSearch(3);await pool.query('INSERT INTO farming_usage(user_id,chats) VALUES(3,5)');
 assert.notEqual(await startSearch(4),wait);
});
test('API rejects forged premium and invalid filters and exposes authoritative allowance',async()=>{
 for(const body of [{mode:'video'},{filters:{ageMin:17}},{filters:{ageMin:30,ageMax:20}},{filters:{ageMax:'30'}},{filters:{gender:[]}}])assert.equal((await request(1,'/start',body)).status,400);
 assert.equal((await request(1,'/start',{premium:true,filters:{religion:'Catholic'}})).status,403);
 const result=await request(1,'/allowance');assert.equal(result.status,200);assert.equal(result.body.chatsRemaining,5);assert.equal(result.body.callsRemaining,3);assert.equal(result.body.premium,false);
});
test('call signaling requires an active call, membership and correct offer/answer roles',async()=>{
 const id=await startSearch(1,null,{mode:'call'});
 assert.equal((await request(1,'/'+id+'/signals',{type:'offer',sdp:'test'})).status,409);
 await startSearch(2,null,{mode:'call'});
 assert.equal((await request(3,'/'+id+'/signals')).status,404);
 assert.equal((await request(3,'/'+id+'/signals',{type:'offer',sdp:'test'})).status,404);
 assert.equal((await request(2,'/'+id+'/signals',{type:'offer',sdp:'test'})).status,403);
 assert.equal((await request(1,'/'+id+'/signals',{type:'offer',sdp:'offer'})).status,200);
 assert.equal((await request(2,'/'+id+'/signals',{type:'answer',sdp:'answer'})).status,200);
 const remote=await request(2,'/'+id+'/signals');assert.equal(remote.body.length,1);assert.equal(remote.body[0].payload.sdp,'offer');
 assert.equal((await request(2,'/'+id+'/signals?after='+remote.body[0].id)).body.length,0);
 assert.equal((await request(2,'/'+id+'/signals',{type:'candidate',candidate:{candidate:'ice'}})).status,200);
 assert.equal((await request(1,'/'+id+'/signals',{type:'offer',sdp:'x'.repeat(21000)})).status,400);
 await pool.query("UPDATE aura_sessions SET status='ended' WHERE id=$1",[id]);
 assert.equal((await request(2,'/'+id+'/signals')).status,409);
 await require('../../src/auraFarming').cleanupSignals();
 assert.equal((await pool.query('SELECT * FROM farming_signals WHERE session_id=$1',[id])).rowCount,0);
});
test('API waits for mutual search, then returns a running timer to both people', async () => {
  const first = await request(1, '/start', {});
  assert.equal(first.body.status, 'waiting');
  assert.equal(first.body.partner, null);
  assert.equal(first.body.secondsRemaining, 0);
  const second = await request(2, '/start', {});
  assert.equal(second.body.sessionId, first.body.sessionId);
  assert.equal(second.body.status, 'active');
  assert.equal(second.body.partner.id, 1);
  assert.ok(second.body.secondsRemaining > 290);
  const poll = await request(1, '/' + first.body.sessionId + '/heartbeat', {});
  assert.equal(poll.body.status, 'active');
  assert.equal(poll.body.partner.id, 2);
});
test('API cancellation removes a waiting search and rejects another user heartbeat', async () => {
  const first = await request(1, '/start', {});
  const id = first.body.sessionId;
  assert.equal((await request(2, '/' + id + '/heartbeat', {})).status, 404);
  assert.equal((await request(1, '/' + id + '/end', {})).status, 200);
  assert.equal((await request(1, '/' + id + '/heartbeat', {})).body.status, 'ended');
  const second = await request(2, '/start', {});
  assert.equal(second.body.status, 'waiting');
  assert.notEqual(second.body.sessionId, id);
});
test('API expires stale searches instead of silently restoring them', async () => {
  const first = await request(1, '/start', {});
  await pool.query("UPDATE aura_sessions SET search_expires_at = NOW() - INTERVAL '1 second' WHERE id=$1", [first.body.sessionId]);
  const poll = await request(1, '/' + first.body.sessionId + '/heartbeat', {});
  assert.equal(poll.body.status, 'ended');
  assert.equal(poll.body.canChat, false);
});

test('Show identity is enforced after one minute; one person cannot reveal both', async () => {
  const id = await startSearch(1);
  await startSearch(2);
  assert.equal((await request(1, '/' + id + '/reveal', {})).status,403);
  await pool.query("UPDATE aura_sessions SET created_at=NOW()-INTERVAL '61 seconds' WHERE id=$1",[id]);
  const ready = await request(1, '/' + id + '/status');
  assert.equal(ready.body.canReveal,true);
  const first = await request(1, '/' + id + '/reveal', {});
  assert.equal(first.body.matched,false);
  const other = await request(2, '/' + id + '/status');
  assert.equal(other.body.partnerRevealRequested,true);
  assert.equal(other.body.revealRequested,false);
  assert.equal((await pool.query('SELECT * FROM matches')).rowCount,0);
  assert.equal((await session(id)).status,'active');
  assert.equal((await request(3,'/' + id + '/reveal',{})).status,404);
});
test('mutual reveal removes timer, preserves messages, and is idempotent under concurrent requests', async () => {
  const id = await startSearch(1);
  await startSearch(2);
  await pool.query("UPDATE aura_sessions SET created_at=NOW()-INTERVAL '61 seconds' WHERE id=$1",[id]);
  await pool.query("INSERT INTO aura_session_messages(session_id,sender_id,content) VALUES($1,1,'Hello'),($1,2,'Hi')",[id]);
  const results = await Promise.all([request(1,'/' + id + '/reveal',{}),request(2,'/' + id + '/reveal',{}),request(2,'/' + id + '/reveal',{})]);
  assert.ok(results.every(result=>result.status===200));
  const match = (await pool.query('SELECT * FROM matches')).rows[0];
  assert.equal(match.revealed,true);
  assert.equal(match.soul_game_completed,true);
  assert.equal((await pool.query('SELECT * FROM matches')).rowCount,1);
  assert.equal((await pool.query('SELECT * FROM messages')).rowCount,2);
  const status = await request(1,'/' + id + '/status');
  assert.equal(status.body.status,'matched');
  assert.equal(status.body.matchId,match.id);
  assert.equal(status.body.expiresAt,null);
});

test('message fetching does not imply Read; recipient acknowledgements advance Sent, Delivered, Read', async () => {
  const match = await pool.query('INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES(1,2,TRUE) RETURNING id');
  const id = match.rows[0].id;
  const inserted = await pool.query("INSERT INTO messages(match_id,sender_id,content) VALUES($1,1,'Hello') RETURNING id",[id]);
  const messageId = inserted.rows[0].id;
  const fetched = await request(2,'/matches/' + id + '/messages');
  assert.equal(fetched.body[0].read_at,null);
  assert.equal(fetched.body[0].delivered_at,null);
  assert.equal((await request(3,'/matches/' + id + '/receipts',{ids:[messageId],read:true})).status,404);
  assert.deepEqual((await request(1,'/matches/' + id + '/receipts',{ids:[messageId],read:true})).body,[]);
  const delivered = await request(2,'/matches/' + id + '/receipts',{ids:[messageId],read:false});
  assert.ok(delivered.body[0].delivered_at);
  assert.equal(delivered.body[0].read_at,null);
  const read = await request(2,'/matches/' + id + '/receipts',{ids:[messageId],read:true});
  assert.ok(read.body[0].read_at);
  assert.equal(read.body[0].delivered_at,delivered.body[0].delivered_at);
  const repeat = await request(2,'/matches/' + id + '/receipts',{ids:[messageId],read:false});
  assert.equal(repeat.body[0].read_at,read.body[0].read_at);
});
test('Soul Talk receipts belong to the receiver and survive mutual reveal', async () => {
  const id = await startSearch(1); await startSearch(2);
  const sent = await request(1,'/' + id + '/messages',{content:'A message'});
  assert.equal(sent.status,201);
  const receipt = await request(2,'/' + id + '/receipts',{ids:[sent.body.id],read:true});
  assert.ok(receipt.body[0].read_at);
  await pool.query("UPDATE aura_sessions SET created_at=NOW()-INTERVAL '61 seconds' WHERE id=$1",[id]);
  await request(1,'/' + id + '/reveal',{});
  const reveal = await request(2,'/' + id + '/reveal',{});
  const messages = await request(1,'/matches/' + reveal.body.matchId + '/messages');
  assert.equal(messages.body[0].read_at,receipt.body[0].read_at);
});
test('partner profiles require mutual reveal and membership, exclude account secrets, and honor blocks', async () => {
  const result = await pool.query('INSERT INTO matches(user1_id,user2_id) VALUES(1,2) RETURNING id');
  const id = result.rows[0].id;
  await pool.query("UPDATE users SET real_name='Partner',email='private@example.com',settings='{}' WHERE id=2");
  assert.equal((await request(1,'/matches/' + id + '/profile')).status,403);
  await pool.query('UPDATE matches SET revealed=TRUE WHERE id=$1',[id]);
  assert.equal((await request(3,'/matches/' + id + '/profile')).status,404);
  const profile = await request(1,'/matches/' + id + '/profile');
  assert.equal(profile.status,200);
  assert.equal(profile.body.real_name,'Partner');
  assert.equal('email' in profile.body,false);
  assert.equal('settings' in profile.body,false);
  assert.ok(Array.isArray(profile.body.interests));
  assert.ok(Array.isArray(profile.body.posts));
  await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(2,1)');
  assert.equal((await request(1,'/matches/' + id + '/profile')).status,403);
});

test('personal profile timeline returns only the authenticated owner posts', async () => {
  await pool.query("INSERT INTO posts(user_id,caption) VALUES(1,'My post'),(2,'Another person post')");
  const response = await request(1,'/profile/posts');
  assert.equal(response.status,200);
  assert.equal(response.body.length,1);
  assert.equal(response.body[0].caption,'My post');
  assert.equal(response.body[0].like_count,0);
  assert.equal(response.body[0].comment_count,0);
});

test('direct conversations can send more than ten messages with zero credits', async () => {
  const match = await pool.query('INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES(1,2,TRUE) RETURNING id');
  for (let index=0; index<12; index++) {
    const response = await request(1,'/matches/' + match.rows[0].id + '/messages',{content:'Unlimited message ' + index});
    assert.equal(response.status,201);
    assert.equal('credits_remaining' in response.body,false);
  }
  assert.equal((await pool.query('SELECT credits FROM users WHERE id=1')).rows[0].credits,0);
});

test('private dating prevents random pairing with unselected users', async()=>{
  await pool.query(`UPDATE users SET settings='{"private_dating":true}'::jsonb WHERE id=1`);
  const first=await startSearch(1);const other=await startSearch(2);
  assert.notEqual(first,other);assert.equal((await session(first)).status,'waiting');assert.equal((await session(other)).status,'waiting');
  await pool.query("UPDATE aura_sessions SET status='ended'");
  await pool.query('INSERT INTO likes(sender_id,receiver_id) VALUES(1,2)');
  const allowed=await startSearch(1);assert.equal(await startSearch(2),allowed);assert.equal((await session(allowed)).status,'active');
});


