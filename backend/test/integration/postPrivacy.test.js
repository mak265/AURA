const imageModeration=require('../../src/imageModeration');
const originalClassifier=imageModeration.classifyImage;
const safeScores=[{className:'Porn',probability:0},{className:'Hentai',probability:0},{className:'Sexy',probability:0},{className:'Neutral',probability:1},{className:'Drawing',probability:0}];
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const express=require('express');
const jwt=require('jsonwebtoken');
const {Pool}=require('pg');
const db=require('../../src/db');
const originalPool=db.pool, originalQuery=db.query;
const schema='post_privacy_test_'+crypto.randomBytes(6).toString('hex');
let pool,server,base,app,posts={};
before(async()=>{
  imageModeration.classifyImage=async()=>safeScores;
  await originalPool.query(`CREATE SCHEMA ${schema}`);
  pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
  db.pool=pool;db.query=(sql,params)=>pool.query(sql,params);
  await pool.query(fs.readFileSync(path.join(__dirname,'../../db/schema.sql'),'utf8').replace(/^DROP TABLE .*;\r?$/gm,''));
  for(const file of fs.readdirSync(path.join(__dirname,'../../db/migrations')).sort()) await pool.query(fs.readFileSync(path.join(__dirname,'../../db/migrations',file),'utf8'));
  for(let id=1;id<=4;id++){
    await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,`test${id}@example.com`,'test']);
    await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)',[id,'Aura '+id]);
  }
  await pool.query('INSERT INTO matches(user1_id,user2_id,revealed) VALUES(1,2,TRUE)');
  await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(1,4)');
  for(const visibility of ['public','connections','private']){
    const result=await pool.query('INSERT INTO posts(user_id,caption,visibility) VALUES(1,$1,$1) RETURNING id',[visibility]);posts[visibility]=result.rows[0].id;
  }
  app=express();app.use(express.json());app.use('/reports',require('../../src/routes/reports'));app.use('/admin',require('../../src/routes/admin'));app.use('/glimpses',require('../../src/routes/glimpses'));app.use('/discover',require('../../src/routes/discover'));app.use('/aura-requests',require('../../src/routes/auraRequests'));app.use('/feed',require('../../src/routes/feed'));app.use('/matches',require('../../src/routes/matches'));app.use('/profile',require('../../src/routes/profile'));
  app.use('/murmurs', require('../../src/routes/murmurs'));
  app.use('/activity', require('../../src/routes/activity'));
  app.use('/auth', require('../../src/routes/auth'));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{imageModeration.classifyImage=originalClassifier;if(server)await new Promise(r=>server.close(r));db.pool=originalPool;db.query=originalQuery;if(pool)await pool.end();await originalPool.query(`DROP SCHEMA ${schema} CASCADE`);await originalPool.end();});
async function request(user,url,method='GET',body){
  const token=jwt.sign({userId:user},process.env.JWT_SECRET);
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  if ([26001, 9501].includes(user) && url.startsWith('/admin/')) {
    headers['X-Aura-Management']=require('../../src/managementMfa').issueManagementToken(token);
  }
  const response=await fetch(base+url,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
  return{status:response.status,body:await response.json()};
}

test('login throttling stops repeated password guesses and returns a retry time', async () => {
  const login = () => fetch(base + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'login-limit-test@example.com', password: 'bad-password' })
  });
  for (let attempt = 0; attempt < 8; attempt++) assert.equal((await login()).status, 401);
  const limited = await login();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});

test('Superadmin MFA requires enrollment, rejects replay, and binds access to one login token', async () => {
  const id = 29003;
  const password = 'mfa-fixture-password';
  await pool.query("INSERT INTO users (id,email,password_hash,management_role) VALUES ($1,'mfa-test@example.com',$2,'superadmin')",
    [id, require('bcryptjs').hashSync(password, 4)]);
  const token = jwt.sign({ userId: id, jti: 'fixture-login-1' }, process.env.JWT_SECRET);
  const access = async (path, body, managementToken, loginToken = token) => {
    const response = await fetch(base + '/admin' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + loginToken, 'Content-Type': 'application/json',
        ...(managementToken ? { 'X-Aura-Management': managementToken } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await access('/me')).body.mfa, 'setup');
  assert.equal((await access('/premium-codes')).body.code, 'MFA_REQUIRED');
  assert.equal((await access('/mfa/setup', { password: 'incorrect' })).status, 403);
  const { body: { secret } } = await access('/mfa/setup', { password });
  const bits = [...secret].map(char => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = crypto.createHmac('sha1', key).update(counter).digest();
  const code = String((hash.readUInt32BE(hash[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
  const verification = await access('/mfa/verify', { code });
  assert.equal(verification.status, 200);
  assert.equal((await access('/mfa/verify', { code })).status, 403);
  assert.equal((await access('/me')).body.mfa, 'verify');
  assert.equal((await access('/premium-codes', null, verification.body.token)).status, 200);
  const otherLogin = jwt.sign({ userId: id, jti: 'fixture-login-2' }, process.env.JWT_SECRET);
  assert.equal((await access('/premium-codes', null, verification.body.token, otherLogin)).status, 403);
});
test('account deletion requires fresh confirmation and removes the account and its push devices', async () => {
  const id = 29001;
  await pool.query("INSERT INTO users (id, email, password_hash) VALUES ($1, 'delete-test@example.com', 'test')", [id]);
  await pool.query("INSERT INTO auras (user_id, aura_name) VALUES ($1, 'Delete test')", [id]);
  await pool.query("INSERT INTO native_push_devices (platform, token, user_id, auth_version) VALUES ('android', 'test-device', $1, 0)", [id]);
  const path = '/profile/account';
  assert.equal((await request(id, path, 'DELETE', { confirmation: 'no' })).status, 400);
  const oldToken = jwt.sign({ userId: id, iat: Math.floor(Date.now() / 1000) - 3600 }, process.env.JWT_SECRET);
  const stale = await fetch(base + path, { method: 'DELETE', headers: {
    Authorization: 'Bearer ' + oldToken, 'Content-Type': 'application/json'
  }, body: JSON.stringify({ confirmation: 'DELETE' }) });
  assert.equal(stale.status, 403);
  assert.equal((await stale.json()).code, 'RECENT_LOGIN_REQUIRED');
  const deleted = await request(id, path, 'DELETE', { confirmation: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal((await request(id, '/profile')).status, 401);
  assert.equal((await pool.query('SELECT 1 FROM auras WHERE user_id = $1', [id])).rowCount, 0);
  assert.equal((await pool.query('SELECT 1 FROM native_push_devices WHERE user_id = $1', [id])).rowCount, 0);
});

test('beta feedback reaches the reports queue with its category', async () => {
  await pool.query("INSERT INTO users (id, email, password_hash) VALUES (29002, 'feedback-test@example.com', 'test')");
  const feedback = await request(29002, '/reports', 'POST', {
    kind: 'bug', reason: 'beta_idea', details: 'Add more themes for connection chats.', contextPath: '/settings'
  });
  assert.equal(feedback.status, 201);
  assert.equal((await request(29002, '/reports/mine')).body[0].reason, 'beta_idea');
});
test('Superadmin giveaway codes enforce claim caps and extend existing Premium', async () => {
  await pool.query(`
    INSERT INTO users (id, email, password_hash, management_role, premium_until) VALUES
      (26001, 'code-admin@example.com', 'test', 'superadmin', NULL),
      (26002, 'code-beta1@example.com', 'test', 'user', NOW() + INTERVAL '10 days'),
      (26003, 'code-beta2@example.com', 'test', 'user', NOW() + INTERVAL '10 days')
  `);
  const endpoint = '/admin/premium-codes';
  const offer = { code: 'AURA-BETA', days: 7, maxClaims: 1, claimWindowDays: 10 };
  assert.equal((await request(26002, endpoint, 'POST', offer)).status, 403);
  const created = await request(26001, endpoint, 'POST', offer);
  assert.equal(created.status, 201);
  const redeem = id => request(id, '/profile/redeem-code', 'POST', { code: ' aura-beta ' });
  const results = await Promise.all([redeem(26002), redeem(26003)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results.findIndex(result => result.status === 200);
  assert.equal(results[winner].body.days, 7);
  assert.ok(Date.parse(results[winner].body.premium_until) > Date.now() + 16 * 86400000);
  assert.match((await redeem(26002 + winner)).body.error, /already redeemed/i);
  const list = await request(26001, endpoint);
  assert.equal(list.body.codes[0].claimed_count, 1);
  assert.equal((await request(26001, endpoint + '/' + created.body.id + '/revoke', 'POST', {})).status, 200);
  assert.equal((await redeem(26003 - winner)).status, 410);
});
test('feed audience filters respect ownership, mutual connections, and blocks',async()=>{
  for(const [user,expected]of [[1,['public','connections','private']],[2,['public','connections']],[3,['public']],[4,[]]]){
    const response=await request(user,'/feed');assert.equal(response.status,200);assert.deepEqual(response.body.map(p=>p.visibility).sort(),expected.sort());
  }
});
test('message alerts target only the recipient and respect muted conversations', async () => {
  const { notifyMessage } = require('../../src/messageAlerts');
  const { rows: [match] } = await pool.query('SELECT id FROM matches WHERE user1_id = 1 AND user2_id = 2');
  const alerts = [];
  const io = {
    in(room) {
      assert.equal(room, 'alerts:2');
      return { fetchSockets: async () => [
        { data: { alertAuthVersion: 0 }, emit: (...args) => alerts.push(args) },
        { data: { alertAuthVersion: -1 }, emit: () => assert.fail('Revoked session received alert') }
      ] };
    }
  };
  await notifyMessage(io, 2, 1, match.id);
  assert.deepEqual(alerts, [['alert:message', { path: `/chat/${match.id}` }]]);
  await pool.query('INSERT INTO conversation_preferences (match_id, user_id, muted) VALUES ($1, 2, TRUE)', [match.id]);
  try {
    await notifyMessage(io, 2, 1, match.id);
    assert.equal(alerts.length, 1);
  } finally {
    await pool.query('DELETE FROM conversation_preferences WHERE match_id = $1 AND user_id = 2', [match.id]);
  }
});
test('Connections badge counts unread conversations once and clears on read or mute', async () => {
  const { rows: [match] } = await pool.query('SELECT id FROM matches WHERE user1_id = 1 AND user2_id = 2');
  const { rows: messages } = await pool.query(
    "INSERT INTO messages (match_id, sender_id, content) VALUES ($1, 1, 'Unread one'), ($1, 1, 'Unread two') RETURNING id", [match.id]
  );
  try {
    assert.equal((await request(2, '/matches/unread-count')).body.count, 1);
    assert.equal((await request(1, '/matches/unread-count')).body.count, 0);
    await pool.query('INSERT INTO conversation_preferences (match_id, user_id, muted) VALUES ($1, 2, TRUE)', [match.id]);
    assert.equal((await request(2, '/matches/unread-count')).body.count, 0);
    await pool.query('DELETE FROM conversation_preferences WHERE match_id = $1 AND user_id = 2', [match.id]);
    await pool.query('UPDATE messages SET read_at = NOW() WHERE id = ANY($1::int[])', [messages.map(message => message.id)]);
    assert.equal((await request(2, '/matches/unread-count')).body.count, 0);
  } finally {
    await pool.query('DELETE FROM conversation_preferences WHERE match_id = $1 AND user_id = 2', [match.id]);
    await pool.query('DELETE FROM messages WHERE id = ANY($1::int[])', [messages.map(message => message.id)]);
  }
});
test('Journal activity alerts target the post author and link to a visibility-checked post', async () => {
  const { rows: [post] } = await pool.query("INSERT INTO posts (user_id, caption) VALUES (1, 'Alert test') RETURNING id");
  const events = [];
  app.set('io', {
    in(room) {
      return { fetchSockets: async () => [
        { data: { alertAuthVersion: 0 }, emit: (event, payload) => events.push({ room, event, ...payload }) }
      ] };
    }
  });
  try {
    const path = `/feed/${post.id}`;
    assert.equal((await request(2, path + '/like', 'POST', { reaction: 'love' })).status, 200);
    assert.equal((await request(2, path + '/comments', 'POST', { text: 'Nice post.' })).status, 201);
    for (let check = 0; check < 20 && events.length < 2; check++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.deepEqual(events.map(event => event.path).sort(), [`/feed?post=${post.id}`, `/feed?post=${post.id}&comments=1`]);
    assert.ok(events.every(event => event.room === 'alerts:1' && event.event === 'alert:activity'));
    const activity = (await request(1, '/feed/activity')).body;
    assert.equal(activity.unread, 2);
    assert.ok(activity.items.every(item => item.post_id === post.id && item.actor_name === 'Aura 2'));
    assert.deepEqual((await request(2, '/feed/activity')).body.items, []);
    assert.equal((await request(2, '/feed/activity/read', 'PATCH', { id: activity.items[0].id })).status, 200);
    assert.equal((await request(1, '/feed/activity')).body.unread, 2);
    assert.equal((await request(1, '/feed/activity/read', 'PATCH', { id: activity.items[0].id })).status, 200);
    assert.equal((await request(1, '/feed/activity')).body.unread, 1);
    assert.deepEqual((await request(1, `/feed?post=${post.id}`)).body.map(row => row.id), [post.id]);
    await pool.query("UPDATE posts SET visibility = 'private' WHERE id = $1", [post.id]);
    assert.deepEqual((await request(2, `/feed?post=${post.id}`)).body, []);
  } finally {
    app.set('io', undefined);
    await pool.query('DELETE FROM posts WHERE id = $1', [post.id]);
  }
});
test('Murmurs are visible to connections, expire, and can be replaced', async () => {
  assert.equal((await request(1, '/murmurs/mine', 'PUT', { body: 'x'.repeat(81) })).status, 400);
  assert.equal((await request(1, '/murmurs/mine', 'PUT', { body: 'Coffee tonight?' })).status, 200);
  assert.equal((await request(1, '/murmurs/mine', 'PUT', { body: 'Tea tonight?' })).status, 200);
  assert.deepEqual((await request(2, '/murmurs')).body.map(note => note.body), ['Tea tonight?']);
  await pool.query("UPDATE users SET profile_photo = 'https://example.com/avatar.png' WHERE id = 1");
  try {
    assert.equal((await request(2, '/murmurs')).body[0].profile_photo, 'https://example.com/avatar.png');
    await pool.query('UPDATE matches SET revealed = FALSE WHERE user1_id = 1 AND user2_id = 2');
    assert.equal((await request(2, '/murmurs')).body[0].profile_photo, null);
  } finally {
    await pool.query('UPDATE matches SET revealed = TRUE WHERE user1_id = 1 AND user2_id = 2');
    await pool.query('UPDATE users SET profile_photo = NULL WHERE id = 1');
  }
  assert.deepEqual((await request(3, '/murmurs')).body, []);
  assert.deepEqual((await request(4, '/murmurs')).body, []);
  await pool.query('UPDATE murmurs SET expires_at = NOW() WHERE user_id = 1');
  assert.deepEqual((await request(2, '/murmurs')).body, []);
});
test('restricted posts cannot expose reactions, comments, or accept interaction via direct URLs',async()=>{
  const comment=await pool.query("INSERT INTO post_comments(post_id,user_id,text) VALUES($1,1,'Private comment') RETURNING id",[posts.private]);
  for(const user of [2,3,4])for(const url of [`/feed/${posts.private}/reactions`,`/feed/${posts.private}/comments`])assert.equal((await request(user,url)).status,404);
  assert.equal((await request(3,`/feed/${posts.connections}/like`,'POST',{reaction:'like'})).status,404);
  assert.equal((await request(2,`/feed/${posts.private}/comments`,'POST',{text:'No access'})).status,404);
  assert.equal((await request(2,`/feed/comments/${comment.rows[0].id}/like`,'POST',{reaction:'like'})).status,404);
});
test('allowed viewers can browse reactions, comments and replies',async()=>{
  assert.equal((await request(2,`/feed/${posts.connections}/like`,'POST',{reaction:'love'})).status,200);
  const comment=await request(2,`/feed/${posts.connections}/comments`,'POST',{text:'Hello'});assert.equal(comment.status,201);
  const reply=await request(1,`/feed/${posts.connections}/comments`,'POST',{text:'Hi',parent_id:comment.body.id});assert.equal(reply.status,201);
  const reactions=await request(1,`/feed/${posts.connections}/reactions`);assert.equal(reactions.body[0].reaction,'love');assert.equal(reactions.body[0].aura_name,'Aura 2');assert.equal('email'in reactions.body[0],false);
  const comments=await request(1,`/feed/${posts.connections}/comments`);assert.equal(comments.body.length,2);assert.equal(comments.body[1].parent_id,comment.body.id);
});
test('partner profiles never include myself-only posts',async()=>{
  const match=(await pool.query('SELECT id FROM matches LIMIT 1')).rows[0].id;
  const response=await request(2,`/matches/${match}/profile`);assert.equal(response.status,200);assert.deepEqual(response.body.posts.map(p=>p.visibility).sort(),['connections','public']);
  const own=await request(1,'/profile/posts');assert.ok(own.body.some(p=>p.visibility==='private'));
});
test('author can change existing audience; former viewers lose all post access',async()=>{
  assert.equal((await request(2,`/feed/${posts.connections}/privacy`,'PATCH',{visibility:'public'})).status,403);
  assert.equal((await request(1,`/feed/${posts.connections}/privacy`,'PATCH',{visibility:'invalid'})).status,400);
  assert.equal((await request(1,`/feed/${posts.connections}/privacy`,'PATCH',{visibility:'private'})).status,200);
  assert.equal((await request(2,`/feed/${posts.connections}/comments`)).status,404);
  assert.equal((await request(2,`/feed/${posts.connections}/reactions`)).status,404);
});
test('profile view history is private, Premium gated, and deduplicated', async () => {
  assert.equal((await request(1, '/profile/views')).body.code, 'PREMIUM_REQUIRED');
  assert.equal((await request(4, '/discover/1/view', 'POST')).status, 404);
  assert.equal((await request(1, '/discover/1/view', 'POST')).status, 404);
  for (let visit = 0; visit < 2; visit++) {
    const response = await fetch(base + '/discover/1/view', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + jwt.sign({ userId: 3 }, process.env.JWT_SECRET) }
    });
    assert.equal(response.status, 204);
  }
  assert.equal((await request(1, '/profile')).body.stats.profileViewers, 2);
  await pool.query("UPDATE users SET premium_until = NOW() + INTERVAL '1 hour' WHERE id = 1");
  try {
    const { status, body } = await request(1, '/profile/views');
    assert.equal(status, 200);
    assert.deepEqual(body.viewers.map(viewer => viewer.aura_name), ['Aura 3', 'Aura 2']);
    assert.deepEqual(Object.keys(body.viewers[0]).sort(), ['aura_name', 'id', 'viewed_at']);
    await pool.query("UPDATE users SET settings = jsonb_set(COALESCE(settings, '{}'), '{private_dating}', 'true') WHERE id = 3");
    assert.deepEqual((await request(1, '/profile/views')).body.viewers.map(viewer => viewer.id), [2]);
    assert.equal((await request(1, '/profile')).body.stats.profileViewers, 1);
  } finally {
    await pool.query("UPDATE users SET premium_until = NULL WHERE id = 1");
    await pool.query("UPDATE users SET settings = settings - 'private_dating' WHERE id = 3");
  }
  assert.equal((await request(1, '/profile/views')).status, 403);
});
test('post creation validates audience and preserves public default',async()=>{
  assert.equal((await request(1,'/feed','POST',{caption:'Test',visibility:'invalid'})).status,400);
  const own=await request(1,'/feed','POST',{caption:'Only me',visibility:'private'});assert.equal(own.status,201);assert.equal(own.body.visibility,'private');
  const legacy=await request(1,'/feed','POST',{caption:'Public default'});assert.equal(legacy.status,201);assert.equal(legacy.body.visibility,'public');
});

test('public post opening messages stay in requests until the recipient accepts',async()=>{
  const before=(await pool.query('SELECT count(*)::int AS total FROM matches')).rows[0].total;
  const sent=await request(3,'/aura-requests','POST',{postId:posts.public,message:'Your post caught my interest.'});
  assert.equal(sent.status,201);assert.equal(sent.body.status,'pending');
  const sentList=await request(3,'/aura-requests?direction=sent');assert.equal(sentList.body.length,1);assert.equal(sentList.body[0].aura_name,'Aura 1');assert.equal(sentList.body[0].status,'pending');
  assert.equal((await request(2,'/aura-requests?direction=sent')).body.length,0);
  assert.equal((await request(3,'/aura-requests?direction=invalid')).status,400);
  const again=await request(3,'/aura-requests','POST',{postId:posts.public,message:'Duplicate opening'});assert.equal(again.body.id,sent.body.id);
  assert.equal((await pool.query('SELECT count(*)::int AS total FROM matches')).rows[0].total,before);
  assert.equal((await pool.query('SELECT * FROM messages WHERE sender_id=3')).rowCount,0);
  const inbox=await request(1,'/aura-requests');assert.equal(inbox.body.length,1);assert.equal(inbox.body[0].opening_message,'Your post caught my interest.');assert.equal('real_name'in inbox.body[0],false);
  assert.equal((await request(2,'/aura-requests')).body.length,0);
  assert.equal((await request(3,'/aura-requests/'+sent.body.id+'/accept','POST',{})).status,404);
  const [a,b]=await Promise.all([request(1,'/aura-requests/'+sent.body.id+'/accept','POST',{}),request(1,'/aura-requests/'+sent.body.id+'/accept','POST',{})]);
  assert.equal((await request(3,'/aura-requests?direction=sent')).body[0].status,'accepted');
  assert.equal(a.body.status,'accepted');assert.equal(a.body.matchId,b.body.matchId);
  const match=(await pool.query('SELECT * FROM matches WHERE id=$1',[a.body.matchId])).rows[0];assert.equal(match.soul_game_completed,true);assert.equal(match.revealed,false);
  const messages=await pool.query('SELECT content FROM messages WHERE match_id=$1',[match.id]);assert.equal(messages.rowCount,1);assert.equal(messages.rows[0].content,'Your post caught my interest.');
  assert.equal((await request(1,'/aura-requests')).body.length,0);
});
test('blocked, private, and self requests are rejected; declining never opens chat',async()=>{
  assert.equal((await request(4,'/aura-requests','POST',{postId:posts.public,message:'Hello'})).status,404);
  assert.equal((await request(3,'/aura-requests','POST',{postId:posts.private,message:'Hello'})).status,404);
  assert.equal((await request(1,'/aura-requests','POST',{postId:posts.public,message:'Hello'})).status,400);
  assert.equal((await request(3,'/aura-requests','POST',{postId:posts.public,message:' '})).status,400);
  const source=await pool.query("INSERT INTO posts(user_id,caption) VALUES(3,'Public post') RETURNING id");
  const sent=await request(2,'/aura-requests','POST',{postId:source.rows[0].id,message:'Nice post.'});assert.equal(sent.status,201);
  assert.equal((await request(3,'/aura-requests/'+sent.body.id+'/decline','POST',{})).body.status,'declined');
  const denied=await request(2,'/aura-requests','POST',{postId:source.rows[0].id,message:'Again'});assert.equal(denied.status,409);
  assert.equal((await pool.query('SELECT * FROM matches WHERE (user1_id=2 AND user2_id=3) OR (user1_id=3 AND user2_id=2)')).rowCount,0);
});

test('Journal Aura previews follow current post access and keep the opener available', async () => {
  const sender = 52001;
  const receiver = 52002;
  await pool.query(`INSERT INTO users(id,email,password_hash) VALUES
    ($1,'journal-aura-sender@example.com','test'),($2,'journal-aura-receiver@example.com','test')`, [sender, receiver]);
  const { id: postId } = (await pool.query(`INSERT INTO posts(user_id,caption) VALUES($1,'A rainy afternoon') RETURNING id`, [receiver])).rows[0];
  const send = await request(sender, '/aura-requests', 'POST', { postId, message: 'I love rainy afternoons too.' });
  assert.equal(send.status, 201);
  const inbox = async () => (await request(receiver, '/aura-requests')).body[0];
  const sent = async () => (await request(sender, '/aura-requests?direction=sent')).body[0];
  assert.deepEqual((await inbox()).post_preview, { id: postId, caption: 'A rainy afternoon', has_image: false });
  assert.deepEqual((await sent()).post_preview, (await inbox()).post_preview);

  await pool.query("UPDATE posts SET visibility='private' WHERE id=$1", [postId]);
  assert.equal((await inbox()).post_preview, null);
  assert.equal((await sent()).post_preview, null);
  assert.equal((await inbox()).opening_message, 'I love rainy afternoons too.');

  await pool.query("UPDATE posts SET visibility='public',moderation_hidden_at=NOW() WHERE id=$1", [postId]);
  assert.equal((await inbox()).post_preview, null);
  await pool.query('DELETE FROM posts WHERE id=$1', [postId]);
  assert.equal((await inbox()).post_preview, null);
  assert.equal((await inbox()).opening_message, 'I love rainy afternoons too.');
  assert.equal((await request(receiver, `/aura-requests/${send.body.id}/accept`, 'POST', {})).body.status, 'accepted');
});

test('Journal Aura sending caps concurrent new requests per sender and keeps retries idempotent', async () => {
  const sender = 52101;
  const receivers = Array.from({ length: 11 }, (_, index) => 52102 + index);
  await pool.query(`INSERT INTO users(id,email,password_hash)
    SELECT id,id || '@journal-aura-limit.example','test' FROM unnest($1::int[]) AS ids(id)`, [[sender, ...receivers]]);
  const { rows } = await pool.query(`INSERT INTO posts(user_id,caption)
    SELECT id,'Journal moment' FROM unnest($1::int[]) AS ids(id) RETURNING id`, [receivers]);
  const send = postId => request(sender, '/aura-requests', 'POST', { postId, message: 'Hello from Journal.' });
  const responses = await Promise.all(rows.map(({ id }) => send(id)));
  assert.equal(responses.filter(response => response.status === 201).length, 10);
  assert.equal(responses.filter(response => response.status === 429).length, 1);
  const firstAccepted = responses.findIndex(response => response.status === 201);
  assert.equal((await send(rows[firstAccepted].id)).body.id, responses[firstAccepted].body.id);
});

test('private dating hides discover cards and public posts except outgoing Auras and existing connections',async()=>{
  for(const id of [5,6,7,8]){await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,'private'+id+'@example.com','test']);await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)',[id,'Private test '+id]);}
  const post=(await pool.query("INSERT INTO posts(user_id,caption) VALUES(5,'Private dating post') RETURNING id")).rows[0].id;
  assert.equal((await request(5,'/profile/settings','PUT',{private_dating:true})).status,403);
  await pool.query("UPDATE users SET premium_until = NOW() + INTERVAL '1 hour' WHERE id = 5");
  assert.equal((await request(5,'/profile/settings','PUT',{private_dating:true})).status,200);
  assert.equal((await request(5,'/profile/settings','PUT',{private_dating:'true'})).status,400);
  assert.equal((await request(5,'/profile/settings','PUT',{is_premium:true})).status,400);
  assert.equal((await request(7,'/discover')).body.some(card=>card.id===5),false);
  assert.equal((await request(7,'/feed')).body.some(item=>item.id===post),false);
  assert.equal((await request(7,'/feed/'+post+'/comments')).status,404);
  await pool.query('INSERT INTO likes(sender_id,receiver_id) VALUES(5,6)');
  assert.equal((await request(6,'/discover')).body.some(card=>card.id===5),true);
  assert.equal((await request(6,'/feed')).body.some(item=>item.id===post),true);
  const connection=await pool.query('INSERT INTO matches(user1_id,user2_id,revealed) VALUES(5,8,TRUE) RETURNING id');
  assert.equal((await request(8,'/matches/'+connection.rows[0].id+'/profile')).status,200);
  assert.equal((await request(8,'/feed')).body.some(item=>item.id===post),true);
  const publicPost=(await pool.query("INSERT INTO posts(user_id,caption) VALUES(7,'Public') RETURNING id")).rows[0].id;
  assert.equal((await request(5,'/aura-requests','POST',{postId:publicPost,message:'Hello'})).status,201);
  assert.equal((await request(7,'/discover')).body.some(card=>card.id===5),true);
  assert.equal((await request(4,'/feed')).body.some(item=>item.id===post),false);
  await pool.query("UPDATE users SET premium_until = NOW() - INTERVAL '1 hour' WHERE id = 5");
  assert.equal((await request(4,'/discover')).body.some(card=>card.id===5),false);
  assert.equal((await request(5,'/profile/settings','PUT',{private_dating:false})).status,200);
  assert.equal((await request(4,'/discover')).body.some(card=>card.id===5),true);
  assert.equal((await request(4,'/feed')).body.some(item=>item.id===post),true);
});
test('private members are anonymized in public post reactions and comments for unselected viewers',async()=>{
  await pool.query("UPDATE users SET premium_until = NOW() + INTERVAL '1 hour' WHERE id = 5");
  await request(5,'/profile/settings','PUT',{private_dating:true});
  const publicPost=(await pool.query('SELECT id FROM posts WHERE user_id=7 ORDER BY id DESC LIMIT 1')).rows[0].id;
  await request(5,'/feed/'+publicPost+'/like','POST',{reaction:'like'});
  await request(5,'/feed/'+publicPost+'/comments','POST',{text:'A comment'});
  const strangerReactions=await request(4,'/feed/'+publicPost+'/reactions');assert.equal(strangerReactions.body.find(row=>row.user_id===5).aura_name,'Private member');
  const strangerComments=await request(4,'/feed/'+publicPost+'/comments');assert.equal(strangerComments.body.find(row=>row.user_id===5).aura_name,'Private member');
  const selected=await request(7,'/feed/'+publicPost+'/comments');assert.equal(selected.body.find(row=>row.user_id===5).aura_name,'Private test 5');
});

test('profile photo stays off Aura posts and remains available on a mutually revealed profile',async()=>{
  const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQWQAAAAASUVORK5CYII=';
  assert.equal((await request(1,'/profile/photo','PUT',{photo:'data:image/svg+xml;base64,PHN2Zy8+'})).status,400);
  assert.equal((await request(1,'/profile/photo','PUT',{photo:'data:image/png;base64,YmFk'})).status,400);
  assert.equal((await request(1,'/profile/photo','PUT',{photo,user_id:2})).status,200);
  assert.equal((await pool.query('SELECT profile_photo FROM users WHERE id=2')).rows[0].profile_photo,null);
  const own=await request(1,'/profile');assert.equal(own.body.user.profile_photo,photo);
  const revealedFeed=await request(2,'/feed');assert.ok(revealedFeed.body.filter(post=>post.user_id===1).every(post=>post.profile_photo===null));
  const unrevealedFeed=await request(3,'/feed');assert.ok(unrevealedFeed.body.filter(post=>post.user_id===1).every(post=>post.profile_photo===null));
  const myMatches=await request(3,'/matches');assert.ok(myMatches.body.filter(match=>match.other_user_id===1).every(match=>match.profile_photo===null));
  const match=(await pool.query('SELECT id FROM matches WHERE user1_id=1 AND user2_id=2')).rows[0].id;
  assert.equal((await request(2,'/matches/'+match+'/profile')).body.profile_photo,photo);
  assert.equal((await request(1,'/profile/photo','PUT',{photo:null})).status,200);
  assert.equal((await request(1,'/profile')).body.user.profile_photo,null);
});

test('connection chat supports private image and voice attachments with receipts metadata',async()=>{
  const match=(await pool.query('SELECT id FROM matches WHERE user1_id=1 AND user2_id=2')).rows[0].id;
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQWQAAAAASUVORK5CYII=';
  const image={kind:'image',media:'data:image/png;base64,'+png};
  assert.equal((await request(1,'/matches/'+match+'/messages','POST',image)).status,403);
  await pool.query('UPDATE matches SET soul_game_completed=TRUE WHERE id=$1',[match]);
  const sent=await request(1,'/matches/'+match+'/messages','POST',image);assert.equal(sent.status,201);assert.equal(sent.body.kind,'image');assert.equal('attachment'in sent.body,false);
  const photoPreview = (await request(2, '/matches')).body.find(item => item.id === match);
  assert.equal(photoPreview.last_message_kind, 'image');
  assert.equal(photoPreview.last_message, 'Photo');
  const mediaPath='/matches/'+match+'/messages/'+sent.body.id+'/media';
  const response=await fetch(base+mediaPath,{headers:{Authorization:'Bearer '+jwt.sign({userId:2},process.env.JWT_SECRET)}});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.match(response.headers.get('cache-control'),/private/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(png,'base64'));
  assert.equal((await request(3,mediaPath)).status,404);
  const unauthenticated=await fetch(base+mediaPath);assert.equal(unauthenticated.status,401);
  const voice=await request(2,'/matches/'+match+'/messages','POST',{kind:'audio',media:'data:audio/webm;base64,'+Buffer.from([26,69,223,163,1,2,3,4]).toString('base64'),duration:3.5});
  assert.equal(voice.status,201);assert.equal(voice.body.kind,'audio');assert.equal(voice.body.duration_seconds,3.5);
  const voicePreview = (await request(1, '/matches')).body.find(item => item.id === match);
  assert.equal(voicePreview.last_message_kind, 'audio');
  assert.equal(voicePreview.last_message_duration, 3.5);
  const messages=await request(1,'/matches/'+match+'/messages');assert.ok(messages.body.some(message=>message.id===voice.body.id&&message.kind==='audio'));assert.ok(messages.body.every(message=>!('attachment'in message)));
  await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(2,1)');
  assert.equal((await request(1,mediaPath)).status,404);
  assert.equal((await request(1,'/matches/'+match+'/messages','POST',image)).status,403);
  await pool.query('DELETE FROM blocks WHERE blocker_id=2 AND blocked_id=1');
});
test('chat rejects unsupported attachments, oversized voice duration, and mismatched file types',async()=>{
  const match=(await pool.query('SELECT id FROM matches WHERE user1_id=1 AND user2_id=2')).rows[0].id;
  for(const body of [{kind:'image',media:'data:image/svg+xml;base64,PHN2Zy8+'},{kind:'image',media:'data:image/png;base64,YmFk'},{kind:'audio',media:'data:audio/webm;base64,GkXfowECAwQ=',duration:121},{kind:'text',content:'Hello',media:'unexpected'},{kind:'video',content:'invalid'}])assert.equal((await request(1,'/matches/'+match+'/messages','POST',body)).status,400);
});

test('retrying the same connection message concurrently stores it once', async () => {
  const { rows: [{ id: match }] } = await pool.query('SELECT id FROM matches WHERE user1_id=1 AND user2_id=2');
  const path = `/matches/${match}/messages`;
  const draft = { content: 'Retry check', client_message_id: crypto.randomUUID() };
  const results = await Promise.all([request(1, path, 'POST', draft), request(1, path, 'POST', draft)]);
  try {
    assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
    assert.equal(results[0].body.id, results[1].body.id);
    const history = await request(2, path);
    assert.equal(history.body.filter(message => message.content === draft.content).length, 1);
  } finally {
    await pool.query('DELETE FROM messages WHERE match_id=$1 AND client_message_id=$2', [match, draft.client_message_id]);
  }
});

test('chat replies stay in the same conversation and only authors can edit their text', async () => {
  const { rows: [{ id: match }] } = await pool.query('SELECT id FROM matches WHERE user1_id=1 AND user2_id=2');
  const path = `/matches/${match}/messages`;
  const original = await request(1, path, 'POST', { content: 'Coffee tomorrow?' });
  assert.equal(original.status, 201);
  const originalId = original.body.id;
  const reply = await request(2, path, 'POST', { content: 'Yes, after lunch.', reply_to_id: originalId });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.reply_to_id, originalId);
  assert.equal((await request(2, path, 'POST', { content: 'Hi', reply_to_id: 2147483647 })).status, 404);
  assert.equal((await request(2, `${path}/${originalId}`, 'PATCH', { content: 'Someone else’s edit' })).status, 404);
  const edited = await request(1, `${path}/${originalId}`, 'PATCH', { content: 'Coffee on Friday?' });
  assert.equal(edited.status, 200);
  assert.ok(edited.body.edited_at);
  const history = (await request(2, path)).body;
  assert.equal(history.find(message => message.id === originalId).content, 'Coffee on Friday?');
  assert.equal(history.find(message => message.id === reply.body.id).reply_to_id, originalId);
  await request(2, `${path}/${originalId}/remove`, 'POST', { action: 'delete_for_me' });
  assert.equal((await request(2, path, 'POST', { content: 'Hi', reply_to_id: originalId })).status, 404);
  await pool.query('DELETE FROM messages WHERE id = ANY($1::int[])', [[originalId, reply.body.id]]);
});

test('active status tracks visible tabs, preserves other active tabs, expires, and respects privacy',async()=>{
  const match=(await pool.query('SELECT id FROM matches WHERE user1_id=1 AND user2_id=2')).rows[0].id;
  const tabA=crypto.randomUUID(),tabB=crypto.randomUUID();
  const heartbeat=(sessionId,active)=>request(1,'/profile/presence','POST',{sessionId,active,userId:2});
  assert.equal((await heartbeat(tabA,true)).status,200);
  const online=await request(2,'/matches/'+match+'/presence');assert.equal(online.body.active_now,true);assert.ok(online.body.last_active_at);
  assert.equal((await pool.query('SELECT * FROM user_presence WHERE user_id=2')).rowCount,0);
  await heartbeat(tabB,true);await heartbeat(tabA,false);
  assert.equal((await request(2,'/matches/'+match+'/presence')).body.active_now,true);
  await heartbeat(tabB,false);
  assert.equal((await request(2,'/matches/'+match+'/presence')).body.active_now,false);
  await heartbeat(tabA,true);
  await request(1,'/profile/settings','PUT',{hide_online:true,hide_last_active:true});
  const hidden=await request(2,'/matches/'+match+'/presence');assert.equal(hidden.body.active_now,null);assert.equal(hidden.body.last_active_at,null);
  const list=await request(2,'/matches');assert.equal(list.body.find(item=>item.id===match).active_now,null);
  await request(1,'/profile/settings','PUT',{hide_online:false,hide_last_active:false});
  await pool.query("UPDATE user_presence SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=1");
  assert.equal((await request(2,'/matches/'+match+'/presence')).body.active_now,false);
  assert.equal((await request(3,'/matches/'+match+'/presence')).status,404);
  assert.equal((await request(1,'/profile/presence','POST',{sessionId:'invalid',active:true})).status,400);
  await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(2,1)');
  const blocked=await request(2,'/matches/'+match+'/presence');assert.equal(blocked.body.active_now,null);assert.equal(blocked.body.last_active_at,null);
});

test('conversation settings are private and mute suppresses unread badges',async()=>{
  const id=(await pool.query("INSERT INTO matches(user1_id,user2_id,soul_game_completed,revealed,created_at) VALUES(6,8,TRUE,TRUE,NOW()-INTERVAL '1 day') RETURNING id")).rows[0].id;
  await pool.query('INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES(6,7,TRUE)');
  await pool.query("INSERT INTO messages(match_id,sender_id,content) VALUES($1,8,'A message')",[id]);
  const manage=(user,action)=>request(user,'/matches/'+id+'/manage','POST',{action});
  assert.equal((await manage(1,'pin')).status,404);
  for(const action of ['pin','archive','mute','high_risk'])assert.equal((await manage(6,action)).status,200);
  const own=(await request(6,'/matches')).body;assert.equal(own[0].id,id);assert.equal(own[0].pinned,true);assert.equal(own[0].archived,true);assert.equal(own[0].muted,true);assert.equal(Number(own[0].unread),0);assert.equal(own[0].high_risk,true);
  const peer=(await request(8,'/matches')).body.find(row=>row.id===id);assert.equal(peer.pinned,false);assert.equal(peer.archived,false);assert.equal(peer.muted,false);assert.equal(peer.high_risk,false);
  for(const action of ['unpin','unarchive','unmute','clear_risk'])assert.equal((await manage(6,action)).status,200);
  const restored=(await request(6,'/matches')).body.find(row=>row.id===id);assert.equal(restored.pinned,false);assert.equal(restored.archived,false);assert.equal(restored.muted,false);assert.equal(Number(restored.unread),1);assert.equal(restored.high_risk,false);
  assert.equal((await manage(6,'invalid')).status,400);
});
test('delete clears only your history and new messages can restore the conversation',async()=>{
  const id=(await pool.query('SELECT id FROM matches WHERE user1_id=6 AND user2_id=8')).rows[0].id;
  assert.equal((await request(6,'/matches/'+id+'/manage','POST',{action:'delete'})).status,200);
  assert.equal((await request(6,'/matches')).body.some(row=>row.id===id),false);
  assert.equal((await request(6,'/matches/'+id+'/messages')).body.length,0);
  assert.equal((await request(8,'/matches/'+id+'/messages')).body.length,1);
  assert.equal((await request(6,'/matches/'+id+'/details')).body.soul_game_completed,true);
  assert.equal((await request(8,'/matches/'+id+'/messages','POST',{content:'A new message'})).status,201);
  assert.equal((await request(6,'/matches')).body.some(row=>row.id===id),true);
  const messages=await request(6,'/matches/'+id+'/messages');assert.equal(messages.body.length,1);assert.equal(messages.body[0].content,'A new message');
  assert.equal((await request(8,'/matches/'+id+'/messages')).body.length,2);
});
test('block stops messages; unblock removes only your own block',async()=>{
  const id=(await pool.query('SELECT id FROM matches WHERE user1_id=6 AND user2_id=8')).rows[0].id;
  assert.equal((await request(6,'/matches/'+id+'/manage','POST',{action:'block'})).status,200);
  assert.equal((await request(6,'/matches')).body.find(row=>row.id===id).blocked_by_me,true);
  assert.equal((await request(8,'/matches/'+id+'/messages','POST',{content:'Blocked'})).status,403);
  await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(8,6)');
  await request(6,'/matches/'+id+'/manage','POST',{action:'unblock'});
  assert.equal((await request(6,'/matches/'+id+'/messages','POST',{content:'Still blocked'})).status,403);
  await pool.query('DELETE FROM blocks WHERE blocker_id=8 AND blocked_id=6');
  assert.equal((await request(6,'/matches/'+id+'/messages','POST',{content:'Allowed again'})).status,201);
});

test('message reactions toggle, replace, persist for both participants and reject outsiders or blocks',async()=>{
  const match=(await pool.query('INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES(2,4,TRUE) RETURNING id')).rows[0].id;
  const message=(await pool.query("INSERT INTO messages(match_id,sender_id,content) VALUES($1,2,'React here') RETURNING id",[match])).rows[0].id;
  const url=`/matches/${match}/messages/${message}/reaction`;
  assert.equal((await request(1,url,'POST',{reaction:'love'})).status,404);
  assert.equal((await request(2,url,'POST',{reaction:'invalid'})).status,400);
  assert.deepEqual((await request(2,url,'POST',{reaction:'love'})).body.reactions,[{user_id:2,reaction:'love'}]);
  assert.equal((await request(4,url,'POST',{reaction:'haha'})).body.reactions.length,2);
  assert.equal((await request(2,url,'POST',{reaction:'care'})).body.reactions.find(r=>r.user_id===2).reaction,'care');
  const list=await request(4,`/matches/${match}/messages`);assert.equal(list.body[0].reactions.length,2);
  assert.equal((await request(2,url,'POST',{reaction:'care'})).body.reactions.length,1);
  await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(2,4)');
  assert.equal((await request(4,url,'POST',{reaction:'love'})).status,404);
  await pool.query('DELETE FROM blocks WHERE blocker_id=2 AND blocked_id=4');
  await request(2,`/matches/${match}/manage`,'POST',{action:'delete'});
  assert.equal((await request(2,url,'POST',{reaction:'love'})).status,404);
});

test('unsend enforces sender ownership, ten-minute cap and five minutes after seen; delete is personal',async()=>{
 const match=(await pool.query('INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES(2,3,TRUE) RETURNING id')).rows[0].id;
 const make=async(age,seen)=> (await pool.query("INSERT INTO messages(match_id,sender_id,content,created_at,read_at) VALUES($1,2,'secret',NOW()-$2::interval,CASE WHEN $3::text IS NULL THEN NULL ELSE NOW()-$3::interval END) RETURNING id",[match,age,seen])).rows[0].id;
 const remove=(user,id,action='unsend')=>request(user,`/matches/${match}/messages/${id}/remove`,'POST',{action});
 for(const [age,seen,status] of [['9 minutes',null,200],['11 minutes',null,409],['7 minutes','4 minutes',200],['7 minutes','6 minutes',409],['11 minutes','1 minute',409]]){
  const id=await make(age,seen);assert.equal((await remove(2,id)).status,status);
  if(status===200){const msg=(await request(3,`/matches/${match}/messages`)).body.find(m=>m.id===id);assert.ok(msg.unsent_at);assert.equal(msg.content,'');assert.equal((await request(3,`/matches/${match}/messages/${id}/reaction`,'POST',{reaction:'love'})).status,404);}
 }
 const id=await make('1 minute',null);assert.equal((await remove(3,id)).status,403);assert.equal((await remove(4,id)).status,404);
 assert.equal((await remove(3,id,'delete_for_me')).status,200);
 assert.equal((await request(3,`/matches/${match}/messages`)).body.some(m=>m.id===id),false);
 assert.equal((await request(2,`/matches/${match}/messages`)).body.some(m=>m.id===id),true);
});

test('only author can delete a post, cascading reactions, comments and comment reactions',async()=>{
 const post=(await request(2,'/feed','POST',{caption:'Disposable post',visibility:'public'})).body.id;
 await request(3,`/feed/${post}/like`,'POST',{reaction:'love'});
 const comment=(await request(3,`/feed/${post}/comments`,'POST',{text:'Disposable comment'})).body.id;
 await request(2,`/feed/comments/${comment}/like`,'POST',{reaction:'like'});
 assert.equal((await request(3,`/feed/${post}`,'DELETE')).status,403);
 assert.equal((await request(2,`/feed/${post}`,'DELETE')).status,200);
 for(const [table,column,id] of [['posts','id',post],['post_likes','post_id',post],['post_comments','post_id',post],['comment_likes','comment_id',comment]])assert.equal((await pool.query(`SELECT * FROM ${table} WHERE ${column}=$1`,[id])).rowCount,0);
 assert.equal((await request(3,`/feed/${post}/comments`)).status,404);
});

test('glimpses expire at 24 hours and enforce audiences, private mode, blocks and deletion ownership',async()=>{
 await pool.query("UPDATE users SET settings='{}'::jsonb");
 await pool.query('DELETE FROM blocks WHERE blocker_id=2 OR blocked_id=2');
 const a=await request(2,'/glimpses','POST',{caption:'Hello today',visibility:'public'});assert.equal(a.status,201);
 const b=await request(2,'/glimpses','POST',{caption:'Connections',visibility:'connections'});assert.equal(b.status,201);
 assert.ok(Math.abs(new Date(a.body.expires_at).getTime()-Date.now()-86400000)<5000);
 assert.equal((await request(4,`/glimpses/${a.body.id}`)).status,200);
 assert.equal((await request(1,`/glimpses/${b.body.id}`)).status,200);
 assert.equal((await request(4,`/glimpses/${b.body.id}`)).status,200); // existing test match 2/4
 assert.equal((await request(2,'/glimpses','POST',{caption:'',visibility:'public'})).status,400);
 assert.equal((await request(2,'/glimpses','POST',{caption:'bad',image_url:'https://bad.example/image'})).status,400);
 assert.equal((await request(1,`/glimpses/${a.body.id}`,'DELETE')).status,404);
 await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(2,4)');
 assert.equal((await request(4,`/glimpses/${a.body.id}`)).status,404);
 await pool.query('DELETE FROM blocks WHERE blocker_id=2 AND blocked_id=4');
 await pool.query("UPDATE glimpses SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[a.body.id]);
 assert.equal((await request(2,`/glimpses/${a.body.id}`)).status,404);
 assert.equal((await request(2,'/glimpses')).body.some(g=>g.id===a.body.id),false);
 assert.equal((await request(2,`/glimpses/${b.body.id}`,'DELETE')).status,200);
 assert.equal((await request(1,`/glimpses/${b.body.id}`)).status,404);
});


test('glimpse views count unique viewers, reactions toggle and activity is owner-only',async()=>{
 await pool.query('DELETE FROM blocks WHERE blocker_id=2 OR blocked_id=2');
 const id=(await request(2,'/glimpses','POST',{caption:'Activity test',visibility:'public'})).body.id;
 assert.equal((await request(2,`/glimpses/${id}/view`,'POST',{})).status,200);
 assert.equal((await request(2,`/glimpses/${id}/activity`)).body.view_count,0);
 await request(3,`/glimpses/${id}`); // Loading metadata is not a view receipt.
 assert.equal((await request(3,'/glimpses')).body.find(item=>item.id===id).viewed,false);
 assert.equal((await request(2,`/glimpses/${id}/activity`)).body.view_count,0);
 for(let i=0;i<2;i++)assert.equal((await request(3,`/glimpses/${id}/view`,'POST',{})).status,200);
 assert.equal((await request(3,'/glimpses')).body.find(item=>item.id===id).viewed,true);
 assert.equal((await request(3,`/glimpses/${id}/activity`)).status,404);
 assert.equal((await request(3,`/glimpses/${id}/reaction`,'POST',{reaction:'love'})).body.reaction,'love');
 let activity=(await request(2,`/glimpses/${id}/activity`)).body;assert.equal(activity.view_count,1);assert.equal(activity.reaction_count,1);assert.equal(activity.viewers[0].aura_name,'Aura 3');assert.equal(activity.viewers[0].reaction,'love');
 assert.equal((await request(3,`/glimpses/${id}`)).body.my_reaction,'love');
 assert.equal((await request(3,`/glimpses/${id}/reaction`,'POST',{reaction:'care'})).body.reaction,'care');
 assert.equal((await request(3,`/glimpses/${id}/reaction`,'POST',{reaction:'care'})).body.reaction,null);
 assert.equal((await request(2,`/glimpses/${id}/activity`)).body.reaction_count,0);
 assert.equal((await request(2,`/glimpses/${id}/reaction`,'POST',{reaction:'love'})).status,404);
 assert.equal((await request(3,`/glimpses/${id}/reaction`,'POST',{reaction:'invalid'})).status,400);
 await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(2,3)');
 assert.equal((await request(3,`/glimpses/${id}/view`,'POST',{})).status,404);
 assert.equal((await request(3,`/glimpses/${id}/reaction`,'POST',{reaction:'love'})).status,404);
 await pool.query("UPDATE glimpses SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[id]);
 assert.equal((await request(2,`/glimpses/${id}/activity`)).status,404);
 await request(2,`/glimpses/${id}`,'DELETE');
 assert.equal((await pool.query('SELECT * FROM glimpse_views WHERE glimpse_id=$1',[id])).rowCount,0);
});

test('Discover searches Aura names literally and preserves privacy, blocks and filters',async()=>{
 for(const [id,name,settings,gender] of [[9001,'Search 100% Luna',{},'Female'],[9002,'Search Private Luna',{private_dating:true},'Female'],[9003,'Search Blocked Luna',{},'Male']]){
  await pool.query('INSERT INTO users(id,email,password_hash,settings,gender,real_name) VALUES($1,$2,$3,$4,$5,$6)',[id,`${id}@example.com`,'test',JSON.stringify(settings),gender,'Secret Real Name']);
  await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)',[id,name]);
 }
 await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(3,9003)');
 let response=await request(3,'/discover?q=lUnA');assert.equal(response.status,200);assert.deepEqual(response.body.map(row=>row.id),[9001]);
 assert.equal(response.body[0].real_name,undefined);
 assert.equal(response.body[0].username,'aura_9001');
 assert.equal((await request(9001,'/profile/username','PUT',{username:'@Luna_Notes'})).body.username,'luna_notes');
 assert.equal((await request(9002,'/profile/username','PUT',{username:'LUNA_NOTES'})).status,409);
 assert.deepEqual((await request(3,'/discover?q=%40LuNa_NoTeS')).body.map(row=>row.id),[9001]);
 assert.deepEqual((await request(3,'/discover?q=%40aura_9002')).body,[]);
 assert.deepEqual((await request(3,'/discover?q=%40aura_9003')).body,[]);
 assert.deepEqual((await request(3,'/discover?q=%25')).body.map(row=>row.id),[9001]);
 assert.equal((await request(3,'/discover?q=Secret%20Real%20Name')).body.length,0);
 assert.equal((await request(3,'/discover?q=Luna&gender=Male')).body.length,0);
 assert.equal((await request(3,'/discover?q='+ 'a'.repeat(81))).status,400);
 assert.equal((await request(3,'/discover?q[]=Luna')).status,400);
 await pool.query('INSERT INTO likes(sender_id,receiver_id) VALUES(9002,3)');
 assert.ok((await request(3,'/discover?q=Private%20Luna')).body.some(row=>row.id===9002));
});

test('active devices distinguish the current session and logout revokes the right sessions', async () => {
  const id = 9006;
  const email = 'device-session-test@example.com';
  const password = 'Device-session-test!';
  const passwordHash = await require('bcryptjs').hash(password, 4);
  await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [id,email,passwordHash]);
  const call = async (path, method='GET', token, body) => {
    const response = await fetch(base+path, {method, headers: {
      Authorization: `Bearer ${token || ''}`, 'Content-Type':'application/json',
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0) Chrome/120'
    }, ...(body ? {body:JSON.stringify(body)} : {})});
    return {status:response.status, body:await response.json()};
  };
  const login = async () => {
    const result = await call('/auth/login','POST',null,{email,password});
    assert.equal(result.status,200);
    return result.body.token;
  };
  const first = await login();
  const second = await login();
  const list = await call('/auth/sessions','GET',first);
  assert.equal(list.status,200);
  assert.deepEqual(list.body.map(item=>item.current),[true,false]);
  assert.equal(list.body[0].device_label,'Windows · Chrome');
  assert.equal((await call('/auth/sessions/current','DELETE',first)).status,200);
  assert.equal((await call('/profile','GET',first)).status,401);
  assert.equal((await call('/auth/sessions','GET',second)).body.length,1);
  const third = await login();
  assert.equal((await call('/auth/sessions','DELETE',second)).status,200);
  assert.equal((await call('/profile','GET',second)).status,401);
  assert.equal((await call('/profile','GET',third)).status,401);
  assert.equal((await call('/profile','GET',await login())).status,200);
});

test('previous usernames can be reclaimed by their original owner and stay reserved after account deletion', async () => {
  const owner = 9004;
  const other = 9005;
  for (const id of [owner, other]) {
    await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [id, `reservation${id}@example.com`, 'test']);
  }
  const save = (user, username) => request(user, '/profile/username', 'PUT', {username});
  assert.equal((await save(owner, 'first_handle')).status, 200);
  assert.equal((await save(owner, 'next_handle')).status, 200);
  assert.equal((await save(other, '@FIRST_HANDLE')).status, 409);
  assert.equal((await save(owner, 'first_handle')).status, 200);
  await pool.query('DELETE FROM users WHERE id=$1', [owner]);
  assert.equal((await save(other, 'first_handle')).status, 409);
  assert.equal((await save(other, 'next_handle')).status, 409);
  const result = await pool.query("SELECT owner_id FROM username_reservations WHERE username='first_handle'");
  assert.equal(result.rows[0].owner_id, null);
});

test('connections feed filters before limit and excludes self, strangers, private posts and blocks',async()=>{
 for(const id of [9101,9102,9103]){await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,`${id}@example.com`,'test']);await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)',[id,'Feed '+id]);}
 await pool.query('INSERT INTO matches(user1_id,user2_id) VALUES(9101,9102)');
 await pool.query("INSERT INTO posts(user_id,caption,visibility,created_at) VALUES(9102,'Friend public','public',NOW()-INTERVAL '2 days'),(9102,'Friend connections','connections',NOW()-INTERVAL '1 day'),(9102,'Friend private','private',NOW()),(9101,'Own post','public',NOW())");
 await pool.query("INSERT INTO posts(user_id,caption,visibility) SELECT 9103,'Stranger '||n,'public' FROM generate_series(1,55) n");
 const response=await request(9101,'/feed?scope=connections');assert.equal(response.status,200);assert.deepEqual(response.body.map(p=>p.caption),['Friend connections','Friend public']);
 assert.equal((await request(9101,'/feed?scope=all')).body.some(p=>p.caption.startsWith('Stranger')),true);
 assert.equal((await request(9103,'/feed?scope=connections')).body.length,0);
 await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(9102,9101)');
 assert.equal((await request(9101,'/feed?scope=connections')).body.length,0);
 assert.equal((await request(9101,'/feed?scope=invalid')).status,400);
});

test('settings blocked list and unblock are limited to the current user',async()=>{
 await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(9103,9101),(9101,9103) ON CONFLICT DO NOTHING');
 const list=await request(9103,'/profile/blocked');assert.equal(list.status,200);assert.deepEqual(list.body.map(row=>row.id),[9101]);assert.equal(list.body[0].aura_name,'Feed 9101');assert.equal(list.body[0].email,undefined);
 assert.equal((await request(9103,'/profile/blocked/9101','DELETE')).status,200);
 assert.equal((await request(9103,'/profile/blocked')).body.length,0);
 assert.equal((await pool.query('SELECT * FROM blocks WHERE blocker_id=9101 AND blocked_id=9103')).rowCount,1);
});

test('moderation shares a fixed-hour counter across surfaces and blocks saving until restriction expires',async()=>{
 for(const id of [9201,9202,9203]){await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,`${id}@example.com`,'test']);await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)',[id,'Moderation '+id]);}
 const post=(await pool.query("INSERT INTO posts(user_id,caption) VALUES(9202,'Safe post') RETURNING id")).rows[0].id;
 const match=(await pool.query('INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES(9201,9202,TRUE) RETURNING id')).rows[0].id;
 let result=await request(9201,'/feed','POST',{caption:'g@go'});assert.equal(result.status,422);assert.equal(result.body.moderation.count,1);
 // Mild profanity in a connection chat is allowed and does not reset warnings.
 assert.equal((await request(9201,`/matches/${match}/messages`,'POST',{content:'shit'})).status,201);
 result=await request(9201,`/feed/${post}/comments`,'POST',{text:'g a g o'});assert.equal(result.body.moderation.count,2);
 result=await request(9201,'/glimpses','POST',{caption:'papatayin kita'});assert.equal(result.status,429);assert.equal(result.body.moderation.count,3);
 const until=result.body.moderation.restricted_until;
 assert.equal((await request(9201,`/matches/${match}/messages`,'POST',{content:'hello'})).status,429);
 assert.equal((await request(9201,'/feed','POST',{caption:'gago'})).body.moderation.restricted_until,until);
 assert.equal((await pool.query("SELECT * FROM posts WHERE user_id=9201")).rowCount,0);
 assert.equal((await pool.query('SELECT * FROM post_comments WHERE user_id=9201')).rowCount,0);
 assert.equal((await pool.query('SELECT * FROM glimpses WHERE user_id=9201')).rowCount,0);
 await pool.query("UPDATE moderation_state SET restricted_until=NOW()-INTERVAL '1 second' WHERE user_id=9201");
 assert.equal((await request(9201,'/feed','POST',{caption:'A fresh start'})).status,201);
 await request(9201,'/feed','POST',{caption:'gago'});
 await pool.query("UPDATE moderation_state SET window_started_at=NOW()-INTERVAL '61 minutes' WHERE user_id=9201");
 assert.equal((await request(9201,'/feed','POST',{caption:'gago'})).body.moderation.count,1);
 const concurrent=await Promise.all([1,2,3].map(()=>request(9203,'/feed','POST',{caption:'gago'})));
 assert.deepEqual(concurrent.map(r=>r.body.moderation.count).sort(),[1,2,3]);assert.equal(concurrent.filter(r=>r.status===429).length,1);
});

test('image moderation gates every photo entrypoint and shares the violation window',async()=>{
 for(const id of [9301,9302]){await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,`${id}@example.com`,'test']);await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)',[id,'Image '+id]);}
 const photo='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1,2,3]).toString('base64');
 const match=(await pool.query('INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES(9301,9302,TRUE) RETURNING id')).rows[0].id;
 try{
  imageModeration.classifyImage=async()=>safeScores.map(item=>({...item,probability:item.className==='Porn'?.7:item.className==='Neutral'?.3:0}));
  assert.equal((await request(9301,'/feed','POST',{image_url:photo})).body.code,'IMAGE_NEEDS_REVIEW');
  assert.equal((await pool.query('SELECT violations FROM moderation_state WHERE user_id=9301')).rows[0].violations,0);
  imageModeration.classifyImage=async()=>{throw new Error('Scanner unavailable');};
  assert.equal((await request(9301,'/glimpses','POST',{image_url:photo})).status,503);
  assert.equal((await pool.query('SELECT violations FROM moderation_state WHERE user_id=9301')).rows[0].violations,0);
  imageModeration.classifyImage=async()=>safeScores.map(item=>({...item,probability:item.className==='Porn'?.98:item.className==='Neutral'?.02:0}));
  assert.equal((await request(9301,'/feed','POST',{image_url:photo})).body.moderation.count,1);
  assert.equal((await request(9301,'/glimpses','POST',{image_url:photo})).body.moderation.count,2);
  assert.equal((await request(9301,`/matches/${match}/messages`,'POST',{kind:'image',media:photo})).status,429);
  assert.equal((await pool.query('SELECT * FROM posts WHERE user_id=9301')).rowCount,0);
  assert.equal((await pool.query('SELECT * FROM glimpses WHERE user_id=9301')).rowCount,0);
  assert.equal((await pool.query('SELECT * FROM messages WHERE sender_id=9301')).rowCount,0);
  await pool.query('DELETE FROM moderation_state WHERE user_id=9301');
  assert.equal((await request(9301,'/profile/photo','PUT',{photo})).body.moderation.count,1);
  assert.equal((await pool.query('SELECT profile_photo FROM users WHERE id=9301')).rows[0].profile_photo,null);
  assert.equal((await request(9301,'/feed','POST',{image_url:'https://example.com/photo.jpg'})).status,400);
  imageModeration.classifyImage=async()=>safeScores;
  assert.equal((await request(9301,'/feed','POST',{image_url:photo})).status,201);
 }finally{imageModeration.classifyImage=async()=>safeScores;}
});

test('Discover batches compatibility data and preserves shared-interest, age and religion scoring',async()=>{
 for(const [id,age] of [[9401,25],[9402,27]]){await pool.query("INSERT INTO users(id,email,password_hash,age,religion) VALUES($1,$2,'test',$3,'Catholic')",[id,`${id}@example.com`,age]);await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)',[id,'Perf '+id]);}
 for(const id of [9401,9402])await pool.query("INSERT INTO interests(id,name,emoji) VALUES($1,$2,'x')",[id,'Perf interest '+id]);
 for(const userId of [9401,9402])for(const interestId of [9401,9402])await pool.query('INSERT INTO user_interests(user_id,interest_id) VALUES($1,$2)',[userId,interestId]);
 await pool.query("INSERT INTO interests(id,name,emoji) VALUES(9403,'Unshared interest','y')");
 await pool.query('INSERT INTO user_interests(user_id,interest_id) VALUES(9402,9403)');
 const query=db.query;let count=0;db.query=(...args)=>{count++;return query(...args);};
 try{const result=await request(9401,'/discover?q=Perf');assert.equal(result.status,200);assert.equal(count,5);assert.equal(result.body.length,1);assert.equal(result.body[0].compatibility,70);assert.equal(result.body[0].interests.length,3);assert.deepEqual(result.body[0].shared_interests.map(interest=>interest.name).sort(),['Perf interest 9401','Perf interest 9402']);assert.ok(result.body[0].reasons.includes('2 shared interests'));}finally{db.query=query;}
});

test('reports validate targets, preserve privacy, deduplicate submissions, and never add strikes',async()=>{
 const post=(await pool.query("INSERT INTO posts(user_id,caption,visibility) VALUES(9402,'Report test','public') RETURNING id")).rows[0].id;
 const privatePost=(await pool.query("INSERT INTO posts(user_id,caption,visibility) VALUES(9402,'Private report test','private') RETURNING id")).rows[0].id;
 assert.equal((await request(9401,'/reports','POST',{kind:'post',postId:privatePost,reason:'spam'})).status,404);
 assert.equal((await request(9402,'/reports','POST',{kind:'post',postId:post,reason:'spam'})).status,400);
 assert.equal((await request(9401,'/reports','POST',{kind:'user',userId:9401,reason:'harassment'})).status,400);
 assert.equal((await request(9401,'/reports','POST',{kind:'post',postId:post,reason:'not-valid'})).status,400);
 assert.equal((await request(9401,'/reports','POST',{kind:'bug',reason:'chat',details:'short'})).status,400);
 assert.equal((await request(9401,'/reports','POST',{kind:'bug',reason:'chat',details:'A useful bug description',contextPath:'/chat?token=secret'})).status,400);
 const [one,two]=await Promise.all([1,2].map(()=>request(9401,'/reports','POST',{kind:'post',postId:post,reason:'spam',details:'Repeated promotional content'})));
 assert.equal(one.body.id,two.body.id);assert.deepEqual([one.status,two.status].sort(),[200,201]);
 const user=await request(9401,'/reports','POST',{kind:'user',userId:9402,reason:'fake_profile'});assert.equal(user.status,201);
 const bug=await request(9401,'/reports','POST',{kind:'bug',reason:'layout',details:'The share button is cut off on my phone.',contextPath:'/feed'});assert.equal(bug.status,201);
 const mine=(await request(9401,'/reports/mine')).body;assert.equal(mine.length,3);assert.equal(mine[0].reporter_id,undefined);assert.equal(mine[0].reported_user_id,undefined);assert.equal(mine[0].details,undefined);
 assert.equal((await request(9402,'/reports/mine')).body.length,0);
 assert.equal((await pool.query('SELECT * FROM moderation_state WHERE user_id=9402')).rowCount,0);
 const match=(await pool.query('INSERT INTO matches(user1_id,user2_id) VALUES(9401,9402) RETURNING id')).rows[0].id;
 assert.equal((await request(9402,'/reports','POST',{kind:'user',matchId:match,reason:'harassment'})).status,201);
 assert.equal((await request(9401,'/profile/report','POST',{reportedId:9402,reason:'fake_profile'})).body.id,user.body.id);
 assert.equal((await request(9302,'/reports','POST',{kind:'user',matchId:match,reason:'harassment'})).status,404);
});
test('report spam is limited to five submissions per ten minutes',async()=>{
 for(let i=0;i<5;i++)assert.equal((await request(9402,'/reports','POST',{kind:'bug',reason:'performance',details:'The app freezes when I open the feed '+i})).status,i<4?201:429);
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM safety_reports WHERE reporter_id=9402')).rows[0].count,5);
});

test('admin RBAC denies forged roles, limits staff actions and protects audit and staff access',async()=>{
 for(const [id,role] of [[9501,'superadmin'],[9502,'admin'],[9503,'staff'],[9504,'user'],[9505,'user']]){await pool.query('INSERT INTO users(id,email,password_hash,management_role) VALUES($1,$2,$3,$4)',[id,`${id}@example.com`,require('bcryptjs').hashSync('temporary-password-123',4),role]);await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)',[id,'Admin test '+id]);}
 assert.equal((await request(9504,'/admin/overview')).status,403);
 const forged=await fetch(base+'/admin/overview',{headers:{Authorization:'Bearer '+jwt.sign({userId:9504,role:'superadmin'},process.env.JWT_SECRET)}});assert.equal(forged.status,403);
 for(const role of [9501,9502,9503])assert.equal((await request(role,'/admin/overview')).status,200);
 assert.equal((await request(9502,'/admin/audit')).status,403);assert.equal((await request(9503,'/admin/team')).status,403);
 assert.equal((await request(9503,'/admin/users/9504/action','POST',{action:'ban',reason:'A serious violation'})).status,403);
 assert.equal((await request(9503,'/admin/users/9504/action','POST',{action:'warn',reason:'Please keep your messages respectful.'})).status,200);
 const noticeInbox = await request(9504, '/profile/management-notices');
 assert.equal(noticeInbox.body.notices[0].reason, 'Please keep your messages respectful.');
 assert.equal('issued_by' in noticeInbox.body.notices[0], false);
 assert.equal((await request(9505, '/profile/management-notices')).body.notices.length, 0);
 const appeal = { kind: 'bug', reason: 'moderation_appeal', noticeId: noticeInbox.body.notices[0].id, details: 'Please review the context of my message.' };
 assert.equal((await request(9505, '/reports', 'POST', appeal)).status, 404);
 const caseReport = await request(9504, '/reports', 'POST', appeal);
 assert.equal(caseReport.status, 201);
 const duplicateAppeal = await request(9504, '/reports', 'POST', appeal);
 assert.equal(duplicateAppeal.body.id, caseReport.body.id);
 assert.equal(duplicateAppeal.body.duplicate, true);
 const appealQueue = await request(9502, '/admin/reports?kind=appeal');
 assert.ok(appealQueue.body.reports.some(report => report.id === caseReport.body.id && report.kind === 'appeal'));
 const bugQueue = await request(9502, '/admin/reports?kind=bug');
 assert.ok(bugQueue.body.reports.every(report => report.id !== caseReport.body.id));
 assert.equal((await request(9502, `/admin/reports/${caseReport.body.id}`, 'PATCH', {
   status: 'resolved', notes: 'Internal review notes',
 })).status, 200);
 const savedCase = (await request(9504, '/profile/management-notices')).body.notices[0].appeals[0];
 assert.equal(savedCase.id, caseReport.body.id);
 assert.equal(savedCase.status, 'resolved');
 assert.equal('management_notes' in savedCase, false);
 assert.equal((await request(9504, '/matches/unread-count')).body.count, 1);
 await request(9504, '/profile/management-notices/read', 'POST', { throughId: noticeInbox.body.notices[0].id });
 assert.equal((await request(9504, '/matches/unread-count')).body.count, 0);
 const warnings=await request(9504,'/profile/warnings');assert.equal(warnings.body.length,1);assert.equal(warnings.body[0].reason,'Please keep your messages respectful.');
 await request(9505,`/profile/warnings/${warnings.body[0].id}/acknowledge`,'POST',{});assert.equal((await request(9504,'/profile/warnings')).body.length,1);
 await request(9504,`/profile/warnings/${warnings.body[0].id}/acknowledge`,'POST',{});assert.equal((await request(9504,'/profile/warnings')).body.length,0);
 assert.equal((await request(9502,'/admin/users/9501/action','POST',{action:'ban',reason:'Cannot manage superadmin'})).status,403);
 assert.equal((await request(9502,'/admin/users/9504/action','POST',{action:'restrict',hours:24,reason:'Repeated harassment confirmed.'})).status,200);
 const rejected=await request(9504,'/feed','POST',{caption:'Hello world'});assert.equal(rejected.status,403);assert.equal(rejected.body.code,'ADMIN_RESTRICTED');
 assert.equal((await request(9502,'/admin/users/9504/action','POST',{action:'unrestrict',reason:'Restriction reviewed and lifted.'})).status,200);
 assert.equal((await request(9504,'/feed','POST',{caption:'Hello world'})).status,201);
 assert.equal((await request(9502,'/admin/users/9504/action','POST',{action:'ban',reason:'Scam activity was confirmed.'})).status,200);
 assert.equal((await request(9504,'/profile')).body.code,'ACCOUNT_BANNED');
 const banLogin = await request(9504, '/auth/login', 'POST', { email: '9504@example.com', password: 'temporary-password-123' });
 assert.equal(banLogin.status, 403);
 assert.match(banLogin.body.error, /Scam activity was confirmed/);
 assert.equal((await request(9502,'/admin/users/9504/action','POST',{action:'unban',reason:'Appeal accepted after review.'})).status,200);
 assert.equal((await request(9504,'/profile')).status,401); // Old session stays revoked after unban.
 assert.equal((await request(9501,'/admin/users/9505')).status,200);
 for(const actor of [9502,9503,9505])assert.equal((await request(actor,'/admin/users/9505/action','POST',{action:'premium',hours:720,reason:'Development Premium grant'})).status,403);
 assert.equal((await request(9501,'/admin/users/9505/action','POST',{action:'premium',hours:720,reason:'Development Premium grant'})).status,200);
 assert.ok(new Date((await pool.query('SELECT premium_until FROM users WHERE id=9505')).rows[0].premium_until)>new Date());
 assert.equal((await request(9501,'/admin/users/9505/action','POST',{action:'unpremium',reason:'Development grant removed'})).status,200);
 assert.equal((await pool.query('SELECT premium_until FROM users WHERE id=9505')).rows[0].premium_until,null);
 const audit=(await request(9501,'/admin/audit')).body.events;assert.ok(audit.some(event=>event.action==='user_warn'));assert.ok(audit.some(event=>event.action==='user_ban'));assert.ok(audit.some(event=>event.action==='user_details_viewed'));assert.ok(audit.some(event=>event.action==='user_premium'));
 await assert.rejects(pool.query('DELETE FROM management_audit WHERE id=$1',[audit[0].id]),/append-only/);
});
test('superadmin creates management accounts, password rotation is enforced and role changes revoke sessions',async()=>{
 assert.equal((await request(9502,'/admin/team','POST',{email:'staff-created@example.com',role:'staff',password:'temporary-password-123'})).status,403);
 await pool.query("SELECT setval(pg_get_serial_sequence('users','id'),(SELECT max(id) FROM users))");
 const made=await request(9501,'/admin/team','POST',{email:'staff-created@example.com',name:'Test Staff',role:'staff',password:'temporary-password-123'});assert.equal(made.status,201);
 const id=made.body.id;assert.equal((await request(id,'/admin/me')).body.must_change_password,true);assert.equal((await request(id,'/admin/users')).body.code,'PASSWORD_CHANGE_REQUIRED');
 assert.equal((await request(id,'/admin/password','POST',{currentPassword:'wrong',password:'new-secure-password-123'})).status,400);
 assert.equal((await request(id,'/admin/password','POST',{currentPassword:'temporary-password-123',password:'new-secure-password-123'})).status,200);
 assert.equal((await request(id,'/admin/overview')).status,401);
 assert.equal((await request(9501,`/admin/team/${id}`,'PATCH',{role:'user',reason:'Staff assignment ended.'})).status,200);
 assert.equal((await request(9501,'/admin/team/9501','PATCH',{role:'user',reason:'Cannot demote self.'})).status,403);
 const audit=(await request(9501,'/admin/audit')).body.events;assert.ok(audit.some(event=>event.action==='team_account_created'));assert.ok(audit.some(event=>event.action==='role_changed'));assert.equal(JSON.stringify(audit).includes('temporary-password-123'),false);
});
test('reported conversation evidence is scoped to the reported pair and review actions are audited',async()=>{
 const match=(await pool.query('INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES(9505,9402,TRUE) RETURNING id')).rows[0].id;
 await pool.query("INSERT INTO messages(match_id,sender_id,content) VALUES($1,9402,'Reported conversation evidence')",[match]);
 const report=await request(9505,'/reports','POST',{kind:'user',matchId:match,reason:'harassment'});assert.equal(report.status,201);
 assert.equal((await request(9505,'/admin/reports/'+report.body.id)).status,403);
 const evidence=await request(9503,'/admin/reports/'+report.body.id);assert.equal(evidence.status,200);assert.equal(evidence.body.evidence.messages[0].content,'Reported conversation evidence');
 assert.equal((await request(9503,'/admin/reports/'+report.body.id,'PATCH',{status:'resolved',notes:'Reviewed the report evidence.',assignToMe:true})).status,200);
 const saved=(await pool.query('SELECT * FROM safety_reports WHERE id=$1',[report.body.id])).rows[0];assert.equal(saved.status,'resolved');assert.equal(saved.assigned_to,9503);
 const events=(await request(9501,'/admin/audit')).body.events;assert.ok(events.some(event=>event.action==='report_evidence_viewed'));assert.ok(events.some(event=>event.action==='report_updated'));
});
test('presence accumulates approximate foreground usage once across simultaneous tabs',async()=>{
 const id=9505,session1=crypto.randomUUID(),session2=crypto.randomUUID();
 await request(id,'/profile/presence','POST',{sessionId:session1,active:true});
 await pool.query("UPDATE users SET usage_last_heartbeat=NOW()-INTERVAL '20 seconds' WHERE id=$1",[id]);
 await Promise.all([request(id,'/profile/presence','POST',{sessionId:session1,active:true}),request(id,'/profile/presence','POST',{sessionId:session2,active:true})]);
 let row=(await pool.query('SELECT active_seconds,active_since FROM users WHERE id=$1',[id])).rows[0];assert.ok(Number(row.active_seconds)>=19&&Number(row.active_seconds)<=21);assert.ok(row.active_since);
 await pool.query("UPDATE users SET usage_last_heartbeat=NOW()-INTERVAL '5 minutes' WHERE id=$1",[id]);
 await request(id,'/profile/presence','POST',{sessionId:session1,active:true});
 const after=(await pool.query('SELECT active_seconds FROM users WHERE id=$1',[id])).rows[0];assert.equal(after.active_seconds,row.active_seconds);
 const overview=await request(9501,'/admin/overview');assert.equal(overview.status,200);assert.equal(overview.body.activity.length,7);
});

test('admins can reversibly hide reported posts; staff cannot; every action is audited',async()=>{
 const post=(await pool.query("INSERT INTO posts(user_id,caption,visibility) VALUES(9505,'Post for hide and restore test','public') RETURNING id")).rows[0].id;
 const report=(await request(9401,'/reports','POST',{kind:'post',postId:post,reason:'spam'})).body.id;
 assert.equal((await request(9503,`/admin/reports/${report}/content-action`,'POST',{action:'hide_post',reason:'Confirmed policy violation.'})).status,403);
 assert.equal((await request(9502,`/admin/reports/${report}/content-action`,'POST',{action:'hide_post',reason:'Confirmed policy violation.'})).status,200);
 assert.equal((await request(9401,`/feed/${post}/comments`)).status,404);
 assert.equal((await request(9505,'/profile/posts')).body.some(p=>p.id===post),false);
 assert.equal((await request(9502,`/admin/reports/${report}`)).body.evidence.caption,'Post for hide and restore test');
 assert.equal((await request(9502,`/admin/reports/${report}/content-action`,'POST',{action:'restore_post',reason:'Restored after successful appeal.'})).status,200);
 assert.equal((await request(9401,`/feed/${post}/comments`)).status,200);
 const audit=(await request(9501,'/admin/audit')).body.events;assert.ok(audit.some(row=>row.action==='hide_post'));assert.ok(audit.some(row=>row.action==='restore_post'));
});

test('retained report evidence survives later unsend, is tightly authorized, audited, and purged after expiry',async()=>{
 for(const id of [9601,9602]){await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,`${id}@example.com`,'test']);await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)',[id,'Evidence '+id]);}
 const match=(await pool.query('INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES(9601,9602,TRUE) RETURNING id')).rows[0].id;
 const already=(await pool.query("INSERT INTO messages(match_id,sender_id,content) VALUES($1,9601,'Unsent before report') RETURNING id",[match])).rows[0].id;
 await request(9601,`/matches/${match}/messages/${already}/remove`,'POST',{action:'unsend'});
 const bytes=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
 const kept=(await pool.query("INSERT INTO messages(match_id,sender_id,content,kind,attachment,attachment_mime) VALUES($1,9601,'Retain this reported message','image',$2,'image/png') RETURNING id",[match,bytes])).rows[0].id;
 const hidden=(await pool.query("INSERT INTO messages(match_id,sender_id,content) VALUES($1,9601,'Hidden from reporter') RETURNING id",[match])).rows[0].id;
 await pool.query('INSERT INTO hidden_messages(message_id,user_id) VALUES($1,9602)',[hidden]);
 const report=await request(9602,'/reports','POST',{kind:'user',matchId:match,reason:'harassment'});assert.equal(report.status,201);
 const imageUrl = `/admin/reports/${report.body.id}/messages/${kept}/image`;
 assert.equal((await request(9602, imageUrl)).status, 403);
 const preview = await fetch(base + imageUrl, {
   headers: { Authorization: 'Bearer ' + jwt.sign({ userId: 9502 }, process.env.JWT_SECRET) },
 });
 assert.equal(preview.status, 200);
 assert.equal(preview.headers.get('content-type'), 'image/png');
 assert.match(preview.headers.get('cache-control'), /no-store/);
 assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
 const rows=(await pool.query('SELECT * FROM report_message_evidence WHERE report_id=$1',[report.body.id])).rows;assert.equal(rows.length,1);assert.equal(rows[0].message_id,kept);assert.deepEqual(rows[0].attachment,bytes);
 assert.ok(Math.abs(new Date(rows[0].expires_at)-new Date(report.body.created_at)-30*86400000)<1000);
 await pool.query("INSERT INTO messages(match_id,sender_id,content) VALUES($1,9601,'Sent after report')",[match]);
 assert.equal((await request(9601,`/matches/${match}/messages/${kept}/remove`,'POST',{action:'unsend'})).status,200);
 assert.equal((await request(9502, imageUrl)).status, 404);
 const normal=(await request(9602,`/matches/${match}/messages`)).body.find(message=>message.id===kept);assert.equal(normal.content,'');assert.ok(normal.unsent_at);
 const ordinary=(await request(9502,'/admin/reports/'+report.body.id)).body;assert.equal(ordinary.retained_access,false);assert.equal(ordinary.evidence.messages.find(message=>message.id===kept).content,'');assert.equal(JSON.stringify(ordinary).includes('Retain this reported message'),false);
 const url=`/admin/reports/${report.body.id}/retained-evidence`,reason='Investigating the submitted harassment report.';
 assert.equal((await request(9602,url,'POST',{reason})).status,403);
 assert.equal((await request(9502,url,'POST',{reason})).status,403);
 await request(9503,'/admin/reports/'+report.body.id,'PATCH',{status:'reviewing',notes:'Triage only',assignToMe:true});
 assert.equal((await request(9503,url,'POST',{reason})).status,403); // Self-assigned triage is insufficient.
 assert.equal((await request(9501,url,'POST',{reason:''})).status,400);
 let opened=await request(9501,url,'POST',{reason});assert.equal(opened.status,200);assert.equal(opened.body.messages[0].content,'Retain this reported message');assert.equal(opened.body.messages[0].unsent_now,true);assert.equal(opened.body.messages[0].attachment,undefined);
 const reviewer=`/admin/reports/${report.body.id}/evidence-reviewer`;
 assert.equal((await request(9502,reviewer,'POST',{reviewerId:9502,reason})).status,403);
 assert.equal((await request(9501,reviewer,'POST',{reviewerId:9602,reason})).status,400);
 assert.equal((await request(9501,reviewer,'POST',{reviewerId:9503,reason})).status,200);
 opened=await request(9503,url,'POST',{reason});assert.equal(opened.status,200);
 const mediaUrl=url+'/'+rows[0].id+'/media';
 const media=await fetch(base+mediaUrl,{method:'POST',headers:{Authorization:'Bearer '+jwt.sign({userId:9503},process.env.JWT_SECRET),'Content-Type':'application/json'},body:JSON.stringify({reason})});assert.equal(media.status,200);assert.match(media.headers.get('cache-control'),/no-store/);assert.deepEqual(Buffer.from(await media.arrayBuffer()),bytes);
 assert.equal((await request(9501,reviewer,'POST',{reviewerId:null,reason:'Reviewer access removed after reassignment.'})).status,200);
 assert.equal((await request(9503,url,'POST',{reason})).status,403);assert.equal((await request(9503,mediaUrl,'POST',{reason})).status,403);
 await pool.query("UPDATE report_message_evidence SET expires_at=NOW()-INTERVAL '1 second' WHERE report_id=$1",[report.body.id]);
 assert.equal((await request(9501,url,'POST',{reason})).status,410);assert.equal((await request(9501,mediaUrl,'POST',{reason})).status,410);
 await require('../../src/reportEvidence').purgeExpiredEvidence();assert.equal((await pool.query('SELECT * FROM report_message_evidence WHERE report_id=$1',[report.body.id])).rowCount,0);
 const audit=(await pool.query("SELECT * FROM management_audit WHERE target_id=$1 AND action IN ('retained_evidence_viewed','retained_media_viewed','evidence_reviewer_assigned')",[report.body.id])).rows;assert.equal(audit.filter(row=>row.action==='retained_evidence_viewed').length,2);assert.ok(audit.some(row=>row.action==='retained_media_viewed'));assert.equal(JSON.stringify(audit).includes('Retain this reported message'),false);
});
test('report snapshots are capped at 30 visible messages and do not grow after report submission',async()=>{
 const match=(await pool.query('INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES(9401,9602,TRUE) RETURNING id')).rows[0].id;
 await pool.query("INSERT INTO messages(match_id,sender_id,content,created_at) SELECT $1,9401,'Context '||n,NOW()-INTERVAL '1 minute'+n*INTERVAL '1 second' FROM generate_series(1,35) n",[match]);
 const report=await request(9602,'/reports','POST',{kind:'user',matchId:match,reason:'other'});assert.equal(report.status,201);
 let rows=(await pool.query('SELECT * FROM report_message_evidence WHERE report_id=$1 ORDER BY message_created_at',[report.body.id])).rows;assert.equal(rows.length,30);assert.equal(rows[0].content,'Context 6');
 await pool.query("INSERT INTO messages(match_id,sender_id,content) VALUES($1,9401,'New context after report')",[match]);
 assert.equal((await request(9602,'/reports','POST',{kind:'user',matchId:match,reason:'other'})).body.duplicate,true);
 rows=(await pool.query('SELECT * FROM report_message_evidence WHERE report_id=$1',[report.body.id])).rows;assert.equal(rows.length,30);assert.equal(rows.some(message=>message.content==='New context after report'),false);
});

test('concurrent report and unsend cannot capture content after it was already unsent',async()=>{
 for(const id of [9701,9702]){await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,`${id}@example.com`,'test']);await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)',[id,'Race '+id]);}
 const match=(await pool.query('INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES(9701,9702,TRUE) RETURNING id')).rows[0].id;
 const message=(await pool.query("INSERT INTO messages(match_id,sender_id,content) VALUES($1,9701,'Race condition evidence') RETURNING id",[match])).rows[0].id;
 const [report,unsend]=await Promise.all([request(9702,'/reports','POST',{kind:'user',matchId:match,reason:'other'}),request(9701,`/matches/${match}/messages/${message}/remove`,'POST',{action:'unsend'})]);
 assert.equal(report.status,201);assert.equal(unsend.status,200);
 const snapshot=(await pool.query('SELECT * FROM report_message_evidence WHERE report_id=$1',[report.body.id])).rows;
 const original=(await pool.query('SELECT unsent_at,content FROM messages WHERE id=$1',[message])).rows[0];assert.equal(original.content,'');assert.ok(original.unsent_at);
 if(snapshot.length){assert.equal(snapshot[0].content,'Race condition evidence');assert.ok(new Date(snapshot[0].captured_at)<=new Date(original.unsent_at));}else assert.equal(snapshot.length,0);
});

test('Soul Talk reports retain text context and report media stays within the 10 MB cap',async()=>{
 for(const id of [9801,9802,9803]){await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,`${id}@example.com`,'test']);await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)',[id,'Retention '+id]);}
 const session=(await pool.query("INSERT INTO aura_sessions(user1_id,user2_id,status) VALUES(9801,9802,'active') RETURNING id")).rows[0].id;
 await pool.query("INSERT INTO aura_session_messages(session_id,sender_id,content) VALUES($1,9801,'Reported Soul Talk context')",[session]);
 const soul=await request(9802,'/reports','POST',{kind:'user',sessionId:session,reason:'other'});assert.equal(soul.status,201);
 let snapshot=(await pool.query('SELECT source,content FROM report_message_evidence WHERE report_id=$1',[soul.body.id])).rows[0];assert.equal(snapshot.source,'soul');assert.equal(snapshot.content,'Reported Soul Talk context');
 const match=(await pool.query('INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES(9803,9802,TRUE) RETURNING id')).rows[0].id;
 const media=Buffer.alloc(5*1024*1024,1);
 for(let i=0;i<3;i++)await pool.query("INSERT INTO messages(match_id,sender_id,content,kind,attachment,attachment_mime) VALUES($1,9803,'Media cap test','image',$2,'image/png')",[match,media]);
 const report=await request(9802,'/reports','POST',{kind:'user',matchId:match,reason:'other'});assert.equal(report.status,201);
 const budget=(await pool.query('SELECT sum(octet_length(attachment))::bigint AS bytes,count(*) FILTER(WHERE media_omitted)::int AS omitted FROM report_message_evidence WHERE report_id=$1',[report.body.id])).rows[0];assert.equal(Number(budget.bytes),10*1024*1024);assert.equal(budget.omitted,1);
});

test('management demographic filters compose with search/status and paginate after filtering',async()=>{
 for(const [id,age,gender,religion] of [[9901,25,'Female','Catholic'],[9902,33,'Female','Catholic'],[9903,25,'Male','Catholic'],[9904,25,'Female','Muslim'],[9905,null,null,null],[9906,16,'Female','Catholic']]){
  await pool.query('INSERT INTO users(id,email,password_hash,real_name,age,gender,religion) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,`${id}@example.com`,'test','Demographic QA '+id,age,gender,religion]);
  await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)',[id,'Demographic QA '+id]);
 }
 const path='/admin/users?q=Demographic%20QA&age_min=20&age_max=30&gender=Female&religion=Catholic';
 let result=await request(9501,path);assert.equal(result.status,200);assert.equal(result.body.total,1);assert.equal(result.body.users[0].id,9901);assert.equal(result.body.users[0].religion,'Catholic');
 assert.equal((await request(9501,path+'&filter=active')).body.total,0);
 assert.equal((await request(9501,path+'&filter=inactive')).body.total,1);
 assert.equal((await request(9501,'/admin/users?q=Demographic%20QA&age_max=17')).body.users[0].id,9906);
 assert.equal((await request(9901,path)).status,403);
 for(const query of ['age_min=50&age_max=20','age_min=-1','age_max=121','age_min=abc','age_min=20.5','age_min[]=20','gender[]=Female'])assert.equal((await request(9501,'/admin/users?'+query)).status,400,query);
 assert.equal((await request(9501,'/admin/users?religion='+encodeURIComponent("Catholic' OR 1=1 --"))).body.total,0);
 const options=(await request(9501,'/admin/user-filter-options')).body;assert.ok(options.genders.includes('Female'));assert.ok(options.religions.includes('Catholic'));
 for(let i=0;i<23;i++)await pool.query('INSERT INTO users(id,email,password_hash,real_name,age,gender,religion) VALUES($1,$2,$3,$4,25,$5,$6)',[10000+i,`demo${i}@example.com`,'test','Demographic QA page '+i,'Female','Catholic']);
 result=await request(9501,path+'&page=2');assert.equal(result.body.total,24);assert.equal(result.body.users.length,4);assert.ok(result.body.users.every(user=>user.age===25&&user.gender==='Female'&&user.religion==='Catholic'));
});

async function seedDiscoverInbox(ids){for(const id of ids){await pool.query('INSERT INTO users(id,email,password_hash,real_name,age,gender) VALUES($1,$2,$3,$4,26,$5)',[id,'discover-'+id+'@example.com','test','Private identity '+id,'Female']);await pool.query('INSERT INTO auras(user_id,aura_name,bio) VALUES($1,$2,$3)',[id,'Discover Aura '+id,'A public introduction']);}}

test('Discover shares the original Aura opener only with its sender and recipient, including after matching', async () => {
  const [sender, receiver, other] = [20031, 20032, 20033];
  await seedDiscoverInbox([sender, receiver, other]);
  const send = (author, recipient, opener) => request(author, `/discover/${recipient}/send-aura`, 'POST', { opener });
  const opener = 'Which trail would you hike again?';
  assert.equal((await send(sender, receiver, '  ' + opener + '  ')).status, 200);
  assert.equal((await send(sender, receiver, 'A duplicate opener')).status, 200);
  assert.equal((await request(receiver, '/discover/auras')).body[0]?.opener, opener);
  assert.equal((await request(sender, '/discover/auras?direction=sent')).body[0]?.opener, opener);
  assert.deepEqual((await request(other, '/discover/auras')).body, []);
  assert.deepEqual((await request(other, '/discover/auras?direction=sent')).body, []);

  const reply = 'Let’s go to the one by the waterfall.';
  const matched = await send(receiver, sender, reply);
  assert.equal(matched.body.canChat, true);
  const received = (await request(sender, '/discover/auras')).body[0];
  assert.equal(received?.opener, reply);
  assert.equal(received.match_id, matched.body.matchId);
  assert.equal((await request(sender, '/discover/auras/count')).body.count, 0);
  await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2)', [sender, receiver]);
  assert.deepEqual((await request(sender, '/discover/auras')).body, []);
  assert.deepEqual((await request(receiver, '/discover/auras')).body, []);
});

test('Discover rejects invalid and moderated Aura openers before saving the Aura', async () => {
  const [sender, receiver] = [20034, 20035];
  await seedDiscoverInbox([sender, receiver]);
  const send = opener => request(sender, `/discover/${receiver}/send-aura`, 'POST', { opener });
  assert.equal((await send('a'.repeat(161))).status, 400);
  assert.equal((await send({ body: 'hello' })).status, 400);
  assert.equal((await send('send me nudes')).body.code, 'TEXT_VIOLATION');
  assert.deepEqual((await request(receiver, '/discover/auras')).body, []);
  assert.equal((await send('   ')).status, 200);
  assert.equal((await request(receiver, '/discover/auras')).body[0]?.opener, null);
});
test('Discover Auras appear in the recipient inbox without exposing identity or becoming Journal requests',async()=>{
 await seedDiscoverInbox([20001,20002,20003]);
 assert.equal((await request(20001,'/discover/20002/send-aura','POST',{})).status,200);
 const inbox=await request(20002,'/discover/auras');assert.equal(inbox.status,200);assert.equal(inbox.body.length,1);assert.equal(inbox.body[0].user_id,20001);
 for(const key of ['real_name','profile_photo','email','password_hash'])assert.equal(key in inbox.body[0],false);
 assert.equal((await request(20002,'/discover/auras/count')).body.count,1);
 assert.equal((await request(20003,'/discover/auras/count')).body.count,0);
 assert.equal((await request(20001,'/discover/auras?direction=sent')).body[0].user_id,20002);
 assert.equal((await pool.query('SELECT * FROM aura_requests WHERE sender_id=20001 AND receiver_id=20002')).rowCount,0);
 assert.equal((await request(20002,'/discover/auras?direction=invalid')).status,400);
 assert.equal((await fetch(base+'/discover/auras/count')).status,401);
});
test('sending an Aura back atomically creates one anonymous connection and clears the recipient inbox',async()=>{
 const results=await Promise.all([request(20002,'/discover/20001/send-aura','POST',{}),request(20001,'/discover/20002/send-aura','POST',{}),request(20002,'/discover/20001/send-aura','POST',{})]);
 for(const r of results){assert.equal(r.status,200);assert.equal(r.body.canChat,r.body.matched);}
 assert.equal(results[0].body.matched,true);assert.equal(results[2].body.matched,true);
 assert.equal(new Set(results.filter(r=>r.body.matched).map(r=>r.body.matchId)).size,1);
 assert.equal((await pool.query('SELECT id FROM matches WHERE (user1_id=20001 AND user2_id=20002) OR (user1_id=20002 AND user2_id=20001)')).rowCount,1);
 assert.equal((await request(20002,'/discover/auras/count')).body.count,0);assert.equal((await request(20001,'/discover/auras/count')).body.count,0);
 const sent=(await request(20001,'/discover/auras?direction=sent')).body[0];assert.equal(sent.match_id,results[0].body.matchId);assert.equal(sent.can_chat,true);
 const chat = await request(20001, `/matches/${sent.match_id}/messages`, 'POST', { content: 'Hello from Discover!' });
 assert.equal(chat.status, 201);
 assert.equal((await request(20001, `/matches/${sent.match_id}/details`)).body.revealed, false);
});
test('existing Discover likes appear automatically; only their recipient can pass and duplicate sends do not revive them',async()=>{
 await seedDiscoverInbox([20011,20012,20013]);
 const id=(await pool.query('INSERT INTO likes(sender_id,receiver_id) VALUES(20011,20012) RETURNING id')).rows[0].id;
 assert.equal((await request(20012,'/discover/auras')).body[0].id,id);
 assert.equal((await request(20013,'/discover/auras/'+id+'/pass','POST',{})).status,404);
 assert.equal((await request(20012,'/discover/auras/count')).body.count,1);
 assert.equal((await request(20012,'/discover/auras/'+id+'/pass','POST',{})).status,200);
 assert.equal((await request(20012,'/discover/auras/'+id+'/pass','POST',{})).status,200);
 assert.equal((await request(20011,'/discover/20012/send-aura','POST',{})).status,200);
 assert.equal((await request(20012,'/discover/auras/count')).body.count,0);
 assert.equal((await request(20012,'/discover/auras')).body.length,0);
 assert.equal((await request(20011,'/discover/auras?direction=sent')).body.length,1);
});
test('Discover inbox respects private dating, blocks and bans',async()=>{
 await seedDiscoverInbox([20021,20022]);
 await pool.query('UPDATE users SET settings=$1 WHERE id=20021',[JSON.stringify({private_dating:true})]);
 assert.equal((await request(20021,'/discover/20022/send-aura','POST',{})).status,200);
 assert.equal((await request(20022,'/discover/auras/count')).body.count,1);
 assert.equal((await request(20022,'/discover/auras')).body[0].user_id,20021);
 await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES(20022,20021)');
 assert.equal((await request(20022,'/discover/auras/count')).body.count,0);assert.equal((await request(20021,'/discover/auras?direction=sent')).body.length,0);
 assert.equal((await request(20022,'/discover/20021/send-aura','POST',{})).status,404);
 await pool.query('DELETE FROM blocks WHERE blocker_id=20022 AND blocked_id=20021');
 await pool.query('UPDATE users SET banned_at=NOW() WHERE id=20021');
 assert.equal((await request(20022,'/discover/auras/count')).body.count,0);assert.equal((await request(20022,'/discover/auras')).body.length,0);
 assert.equal((await request(20022,'/discover/20021/send-aura','POST',{})).status,404);
});

test('connection calls require membership, explicit acceptance, and valid signal roles', async () => {
  const participants = [27001, 27002];
  for (const id of participants) {
    await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [id, `${id}@example.test`, 'test']);
    await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)', [id, `Call tester ${id}`]);
  }
  const [caller, recipient] = participants;
  const { rows: [match] } = await pool.query(
    'INSERT INTO matches(id,user1_id,user2_id,soul_game_completed) VALUES(27001,$1,$2,TRUE) RETURNING id', participants,
  );
  const url = `/matches/${match.id}/call`;
  assert.equal((await request(4, url, 'POST', {})).status, 404);
  const [first, second] = await Promise.all(participants.map(id => request(id, url, 'POST', {})));
  assert.deepEqual([first.status, second.status].sort(), [200, 201]);
  const call = first.body.call;
  assert.equal(call.id, second.body.call.id);
  const from = call.caller_id;
  const to = from === caller ? recipient : caller;
  const session = `${url}/${call.id}`;
  assert.equal((await request(to, url)).body.call.status, 'ringing');
  assert.equal((await request(from, session + '/signals', 'POST', {type:'offer', sdp:'test'})).status, 409);
  assert.equal((await request(from, session + '/accept', 'POST', {})).status, 403);
  assert.equal((await request(to, session + '/accept', 'POST', {})).body.call.status, 'active');
  assert.equal((await request(to, session + '/signals', 'POST', {type:'offer', sdp:'test'})).status, 403);
  assert.equal((await request(from, session + '/signals', 'POST', {type:'offer', sdp:'test'})).status, 200);
  assert.equal((await request(to, session + '/signals')).body[0].payload.type, 'offer');
  assert.equal((await request(from, session + '/connected', 'POST', {})).status, 200);
  await pool.query("UPDATE connection_calls SET connected_at = NOW() - INTERVAL '65 seconds' WHERE id = $1", [call.id]);
  assert.equal((await request(to, session + '/end', 'POST', {})).status, 200);
  assert.equal((await request(from, session + '/signals')).status, 409);
  const history = (await request(from, `/matches/${match.id}/messages`)).body;
  assert.equal(history.length, 1);
  assert.equal(history[0].kind, 'call');
  assert.equal(history[0].content, 'Voice call ended');
  assert.ok(history[0].duration_seconds >= 65);
  const missed = (await request(from, url, 'POST', {})).body.call;
  await pool.query('UPDATE connection_calls SET expires_at = NOW() WHERE id = $1', [missed.id]);
  assert.equal((await request(to, url)).body.call, null);
  const updatedHistory = (await request(to, `/matches/${match.id}/messages`)).body;
  assert.ok(updatedHistory.some(message => message.content === 'Missed voice call' && message.duration_seconds === null));
  const missedPreview = (await request(to, '/matches')).body.find(item => item.id === match.id);
  assert.equal(missedPreview.last_message_kind, 'call');
  assert.equal(missedPreview.last_message, 'Missed voice call');
  await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2)', [to, from]);
  assert.equal((await request(from, url, 'POST', {})).status, 404);
});

test('Activity groups Journal reactions and keeps Auras, Glimpse replies, Lounge invites and Meet reminders private', async () => {
  const [owner, sender, other] = [28231, 28232, 28233];
  for (const id of [owner, sender, other]) {
    await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [id, 'activity-' + id + '@example.com', 'test']);
    await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)', [id, 'Aura ' + id]);
  }
  const { rows: [post] } = await pool.query("INSERT INTO posts(user_id,caption,visibility) VALUES($1,'Hello','public') RETURNING id", [owner]);
  await pool.query("INSERT INTO journal_activity (recipient_id,actor_id,post_id,body) VALUES ($1,$2,$4,'Someone reacted to your post.'), ($1,$3,$4,'Someone reacted to your post.')", [owner, sender, other, post.id]);
  assert.equal((await request(other, `/discover/${owner}/send-aura`, 'POST', {})).status, 200);
  const { rows: [glimpse] } = await pool.query("INSERT INTO glimpses(user_id,caption,visibility) VALUES($1,'Hi','public') RETURNING id", [owner]);
  assert.equal((await request(owner, `/glimpses/${glimpse.id}/reply`, 'POST', { body: 'My reply' })).status, 404);
  assert.equal((await request(sender, `/glimpses/${glimpse.id}/reply`, 'POST', { body: 'Nice to see you' })).status, 201);
  const { rows: [match] } = await pool.query('INSERT INTO matches(user1_id,user2_id,revealed,soul_game_completed) VALUES($1,$2,TRUE,TRUE) RETURNING id', [owner, sender]);
  const invite = '/aura-lounge?room=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.equal((await request(sender, `/matches/${match.id}/messages`, 'POST', { content: invite })).status, 201);
  const { rows: [meet] } = await pool.query("INSERT INTO meet_sessions(title,mode,starts_at,ends_at) VALUES('Friday Voice Night','call',NOW(),NOW()+INTERVAL '1 hour') RETURNING id");
  await pool.query('INSERT INTO meet_session_reminders(session_id,user_id,notified_at) VALUES($1,$2,NOW())', [meet.id, owner]);

  const activity = await request(owner, '/activity');
  assert.equal(activity.status, 200);
  assert.equal(activity.body.unread, 5);
  const items = Object.fromEntries(activity.body.items.map(item => [item.source, item]));
  assert.equal(items.journal.actor_count, 2);
  assert.equal(items['glimpse-reply'].detail, 'Nice to see you');
  assert.equal(items['lounge-invite'].path, invite);
  assert.equal(items['meet-session'].path, `/aura-chat?session=${meet.id}`);
  assert.match(items.aura.path, /^\/discover\?aura=\d+$/);
  assert.equal((await request(other, '/activity')).body.items.length, 0);
  await request(other, '/activity/read', 'PATCH', { id: items.aura.id });
  assert.equal((await request(owner, '/activity')).body.unread, 5);
  await request(owner, '/activity/read', 'PATCH', { id: items.journal.id });
  assert.equal((await request(owner, '/activity')).body.unread, 4);
  await pool.query('UPDATE glimpses SET expires_at=NOW() WHERE id=$1', [glimpse.id]);
  assert.equal((await request(sender, `/glimpses/${glimpse.id}/reply`, 'POST', { body: 'Late reply' })).status, 404);
  assert.equal((await request(owner, '/activity')).body.unread, 3);
  await request(owner, '/activity/read', 'PATCH', {});
  assert.equal((await request(owner, '/activity')).body.unread, 0);
});

test('Journal identity is opt-in per post and a real-profile audience cannot widen silently', async () => {
  const [author, stranger, connection] = [28301, 28302, 28303];
  for (const id of [author, stranger, connection]) {
    await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [id, `post-identity-${id}@example.com`, 'test']);
  }
  await pool.query("INSERT INTO auras(user_id,aura_name) VALUES ($1,'Blue Aura')", [author]);
  const create = input => request(author, '/feed', 'POST', { caption: 'Hello from Journal', ...input });
  assert.equal((await create({ identity_mode: 'unknown' })).status, 400);
  assert.equal((await create({ identity_mode: 'profile' })).status, 409);
  await pool.query("UPDATE users SET real_name='Avery Reyes', profile_photo='profile-photo' WHERE id=$1", [author]);
  const { rows: [match] } = await pool.query('INSERT INTO matches(user1_id,user2_id,revealed) VALUES($1,$2,TRUE) RETURNING id', [author, connection]);

  const aura = await create({});
  assert.equal(aura.status, 201);
  assert.equal(aura.body.identity_mode, 'aura');
  const partnerPosts = (await request(connection, `/matches/${match.id}/profile`)).body.posts;
  assert.equal(partnerPosts.find(post => post.id === aura.body.id).author_name, 'Blue Aura');
  assert.equal(partnerPosts.find(post => post.id === aura.body.id).profile_photo, null);

  const real = await create({ identity_mode: 'profile', visibility: 'private' });
  assert.equal(real.status, 201);
  const id = real.body.id;
  assert.equal((await request(author, '/profile/posts')).body.find(post => post.id === id).author_name, 'Avery Reyes');
  assert.deepEqual((await request(stranger, `/feed?post=${id}`)).body, []);
  assert.equal((await request(author, `/feed/${id}/privacy`, 'PATCH', { visibility: 'public' })).status, 409);
  assert.deepEqual((await request(stranger, `/feed?post=${id}`)).body, []);
  assert.equal((await request(author, `/feed/${id}/privacy`, 'PATCH', { visibility: 'public', confirm_profile_visibility: true })).status, 200);
  const { body: [visible] } = await request(stranger, `/feed?post=${id}`);
  assert.equal(visible.author_name, 'Avery Reyes');
  assert.equal(visible.profile_photo, 'profile-photo');
  assert.equal(visible.aura_name, 'Avery Reyes');
  assert.equal((await request(author, `/feed/${id}/privacy`, 'PATCH', { visibility: 'connections' })).status, 200);
  assert.deepEqual((await request(stranger, `/feed?post=${id}`)).body, []);
});

test('Journal edits are moderated and author-only, and keep the original identity and audience', async () => {
  const [author, viewer] = [28311, 28312];
  for (const id of [author, viewer]) {
    await pool.query('INSERT INTO users(id,email,password_hash,real_name) VALUES($1,$2,$3,$4)', [id, `journal-${id}@example.com`, 'test', 'Journal Name']);
  }
  const original = (await request(author, '/feed', 'POST', { caption: 'Original caption', identity_mode: 'profile' })).body;
  const path = `/feed/${original.id}`;
  assert.equal((await request(viewer, path, 'PATCH', { caption: 'Someone else’s edit' })).status, 403);
  assert.equal((await request(author, path, 'PATCH', { caption: '' })).status, 400);
  assert.equal((await request(author, path, 'PATCH', { caption: 'g a g o' })).status, 422);
  assert.equal((await request(author, path, 'PATCH', { caption: 'Original caption' })).body.edited_at, null);
  const edited = await request(author, path, 'PATCH', { caption: ' New caption ', identity_mode: 'aura', visibility: 'private' });
  assert.equal(edited.status, 200);
  assert.ok(edited.body.edited_at);
  const { body: [post] } = await request(viewer, `/feed?post=${original.id}`);
  assert.equal(post.caption, 'New caption');
  assert.equal(post.identity_mode, 'profile');
  assert.equal(post.visibility, 'public');
  assert.equal((await request(author, '/profile/posts')).body[0].edited_at, edited.body.edited_at);
});

test('Journal bookmarks are private, idempotent, and respect live post access', async () => {
  const [author, viewer, stranger] = [28321, 28322, 28323];
  for (const id of [author, viewer, stranger]) {
    await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [id, `journal-${id}@example.com`, 'test']);
  }
  const post = async caption => (await request(author, '/feed', 'POST', { caption })).body.id;
  const first = await post('First saved moment');
  const second = await post('Second saved moment');
  const save = id => request(viewer, `/feed/${id}/save`, 'PUT');
  const saved = () => request(viewer, '/feed?scope=saved');
  assert.equal((await save(first)).status, 200);
  assert.equal((await save(first)).status, 200);
  assert.equal((await save(second)).status, 200);
  const list = (await saved()).body;
  assert.deepEqual(list.map(p => p.id), [second, first]);
  assert.deepEqual((await request(viewer, `/feed?scope=saved&before=${list[0].save_cursor}`)).body.map(p => p.id), [first]);
  assert.deepEqual((await request(stranger, '/feed?scope=saved')).body, []);
  assert.equal((await request(stranger, `/feed?post=${first}`)).body[0].saved_by_me, false);
  await request(author, `/feed/${second}/privacy`, 'PATCH', { visibility: 'private' });
  assert.equal((await save(second)).status, 404);
  assert.deepEqual((await saved()).body.map(p => p.id), [first]);
  assert.equal((await request(viewer, `/feed/${second}/save`, 'DELETE')).status, 200);
  await request(author, `/feed/${first}`, 'DELETE');
  assert.deepEqual((await saved()).body, []);
  assert.equal((await pool.query('SELECT 1 FROM post_bookmarks WHERE user_id=$1', [viewer])).rowCount, 0);
});
