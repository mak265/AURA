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
let pool,server,base,posts={};
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
  const app=express();app.use(express.json());app.use('/glimpses',require('../../src/routes/glimpses'));app.use('/discover',require('../../src/routes/discover'));app.use('/aura-requests',require('../../src/routes/auraRequests'));app.use('/feed',require('../../src/routes/feed'));app.use('/matches',require('../../src/routes/matches'));app.use('/profile',require('../../src/routes/profile'));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{imageModeration.classifyImage=originalClassifier;if(server)await new Promise(r=>server.close(r));db.pool=originalPool;db.query=originalQuery;if(pool)await pool.end();await originalPool.query(`DROP SCHEMA ${schema} CASCADE`);await originalPool.end();});
async function request(user,url,method='GET',body){const response=await fetch(base+url,{method,headers:{Authorization:'Bearer '+jwt.sign({userId:user},process.env.JWT_SECRET),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()};}
test('feed audience filters respect ownership, mutual connections, and blocks',async()=>{
  for(const [user,expected]of [[1,['public','connections','private']],[2,['public','connections']],[3,['public']],[4,[]]]){
    const response=await request(user,'/feed');assert.equal(response.status,200);assert.deepEqual(response.body.map(p=>p.visibility).sort(),expected.sort());
  }
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

test('private dating hides discover cards and public posts except outgoing Auras and existing connections',async()=>{
  for(const id of [5,6,7,8]){await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,'private'+id+'@example.com','test']);await pool.query('INSERT INTO auras(user_id,aura_name) VALUES($1,$2)',[id,'Private test '+id]);}
  const post=(await pool.query("INSERT INTO posts(user_id,caption) VALUES(5,'Private dating post') RETURNING id")).rows[0].id;
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
  assert.equal((await request(5,'/profile/settings','PUT',{private_dating:false})).status,200);
  assert.equal((await request(4,'/discover')).body.some(card=>card.id===5),true);
  assert.equal((await request(4,'/feed')).body.some(item=>item.id===post),true);
});
test('private members are anonymized in public post reactions and comments for unselected viewers',async()=>{
  await request(5,'/profile/settings','PUT',{private_dating:true});
  const publicPost=(await pool.query('SELECT id FROM posts WHERE user_id=7 ORDER BY id DESC LIMIT 1')).rows[0].id;
  await request(5,'/feed/'+publicPost+'/like','POST',{reaction:'like'});
  await request(5,'/feed/'+publicPost+'/comments','POST',{text:'A comment'});
  const strangerReactions=await request(4,'/feed/'+publicPost+'/reactions');assert.equal(strangerReactions.body.find(row=>row.user_id===5).aura_name,'Private member');
  const strangerComments=await request(4,'/feed/'+publicPost+'/comments');assert.equal(strangerComments.body.find(row=>row.user_id===5).aura_name,'Private member');
  const selected=await request(7,'/feed/'+publicPost+'/comments');assert.equal(selected.body.find(row=>row.user_id===5).aura_name,'Private test 5');
});

test('profile photo can be changed and removed without exposing it before mutual reveal',async()=>{
  const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQWQAAAAASUVORK5CYII=';
  assert.equal((await request(1,'/profile/photo','PUT',{photo:'data:image/svg+xml;base64,PHN2Zy8+'})).status,400);
  assert.equal((await request(1,'/profile/photo','PUT',{photo:'data:image/png;base64,YmFk'})).status,400);
  assert.equal((await request(1,'/profile/photo','PUT',{photo,user_id:2})).status,200);
  assert.equal((await pool.query('SELECT profile_photo FROM users WHERE id=2')).rows[0].profile_photo,null);
  const own=await request(1,'/profile');assert.equal(own.body.user.profile_photo,photo);
  const revealedFeed=await request(2,'/feed');assert.ok(revealedFeed.body.filter(post=>post.user_id===1).every(post=>post.profile_photo===photo));
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
  const mediaPath='/matches/'+match+'/messages/'+sent.body.id+'/media';
  const response=await fetch(base+mediaPath,{headers:{Authorization:'Bearer '+jwt.sign({userId:2},process.env.JWT_SECRET)}});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.match(response.headers.get('cache-control'),/private/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(png,'base64'));
  assert.equal((await request(3,mediaPath)).status,404);
  const unauthenticated=await fetch(base+mediaPath);assert.equal(unauthenticated.status,401);
  const voice=await request(2,'/matches/'+match+'/messages','POST',{kind:'audio',media:'data:audio/webm;base64,'+Buffer.from([26,69,223,163,1,2,3,4]).toString('base64'),duration:3.5});
  assert.equal(voice.status,201);assert.equal(voice.body.kind,'audio');assert.equal(voice.body.duration_seconds,3.5);
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
 assert.equal((await request(2,`/glimpses/${id}/activity`)).body.view_count,0);
 for(let i=0;i<2;i++)assert.equal((await request(3,`/glimpses/${id}/view`,'POST',{})).status,200);
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
 assert.deepEqual((await request(3,'/discover?q=%25')).body.map(row=>row.id),[9001]);
 assert.equal((await request(3,'/discover?q=Secret%20Real%20Name')).body.length,0);
 assert.equal((await request(3,'/discover?q=Luna&gender=Male')).body.length,0);
 assert.equal((await request(3,'/discover?q='+ 'a'.repeat(81))).status,400);
 assert.equal((await request(3,'/discover?q[]=Luna')).status,400);
 await pool.query('INSERT INTO likes(sender_id,receiver_id) VALUES(9002,3)');
 assert.ok((await request(3,'/discover?q=Private%20Luna')).body.some(row=>row.id===9002));
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
 const query=db.query;let count=0;db.query=(...args)=>{count++;return query(...args);};
 try{const result=await request(9401,'/discover?q=Perf');assert.equal(result.status,200);assert.equal(count,4);assert.equal(result.body.length,1);assert.equal(result.body[0].compatibility,70);assert.equal(result.body[0].interests.length,2);assert.ok(result.body[0].reasons.includes('2 shared interests'));}finally{db.query=query;}
});
