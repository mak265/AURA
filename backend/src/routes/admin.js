const express=require('express'),bcrypt=require('bcryptjs'),db=require('../db');
const {authenticate}=require('../middleware/auth'),{audit,requireManagement,superOnly,safeError}=require('../management');
const router=express.Router();router.use(authenticate,requireManagement);
router.use('/reports',require('./adminEvidence'));
const userFields=`u.id,u.email,u.real_name,u.age,u.gender,u.religion,u.city,u.management_role,u.created_at,u.last_active_at,u.active_since,u.active_seconds,u.banned_at,u.admin_restricted_until,u.ban_reason,u.admin_restriction_reason,
 EXISTS(SELECT 1 FROM user_presence p WHERE p.user_id=u.id AND p.expires_at>NOW()) AS active_now,
 (SELECT count(*)::int FROM account_warnings w WHERE w.user_id=u.id) AS warning_count`;
const pageOf=req=>Math.max(0,(Number(req.query.page)||1)-1)*20;
router.get('/me',(req,res)=>res.json({...req.actor,must_change_password:req.user.mustChangePassword}));
router.post('/password',async(req,res)=>{
 const {currentPassword,password}=req.body||{};
 if(typeof currentPassword!=='string'||typeof password!=='string'||password.length<12||password.length>128)return res.status(400).json({error:'Use a new password of 12–128 characters.'});
 let client;try{
  client=await db.pool.connect();await client.query('BEGIN');const result=await client.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE',[req.actor.id]);
  if(!await bcrypt.compare(currentPassword,result.rows[0].password_hash)){await client.query('ROLLBACK');return res.status(400).json({error:'Current password is incorrect.'});}
  if(currentPassword===password){await client.query('ROLLBACK');return res.status(400).json({error:'Choose a different password.'});}
  await client.query('UPDATE users SET password_hash=$2,must_change_password=FALSE,auth_version=auth_version+1 WHERE id=$1',[req.actor.id,await bcrypt.hash(password,12)]);
  await audit(client,req.actor,'password_changed','account',req.actor.id,'Password updated');await client.query('COMMIT');res.json({ok:true,sign_in_again:true});
 }catch(error){if(client)await client.query('ROLLBACK');safeError(res,error);}finally{client?.release();}
});
router.get('/overview',async(req,res)=>{try{
 const [stats,activity,reports,recent]=await Promise.all([
  db.query(`SELECT count(*)::int AS total_users,count(*) FILTER(WHERE banned_at IS NOT NULL)::int AS banned_users,count(*) FILTER(WHERE admin_restricted_until>NOW())::int AS restricted_users,count(*) FILTER(WHERE created_at>NOW()-INTERVAL '7 days')::int AS new_users,
  count(*) FILTER(WHERE EXISTS(SELECT 1 FROM user_presence p WHERE p.user_id=users.id AND p.expires_at>NOW()))::int AS online_users,
  (SELECT count(*)::int FROM safety_reports WHERE status IN ('pending','reviewing')) AS open_reports,
  (SELECT count(*)::int FROM messages WHERE created_at>NOW()-INTERVAL '1 day') AS messages_today,
  (SELECT count(*)::int FROM posts) AS total_posts FROM users WHERE management_role='user'`),
  db.query(`SELECT days.day::date AS day,COALESCE(sum(d.seconds),0)::bigint AS seconds,count(DISTINCT d.user_id)::int AS users FROM generate_series(CURRENT_DATE-6,CURRENT_DATE,INTERVAL '1 day') AS days(day) LEFT JOIN daily_app_usage d ON d.usage_date=days.day AND EXISTS(SELECT 1 FROM users member WHERE member.id=d.user_id AND member.management_role='user') GROUP BY days.day ORDER BY days.day`),
  db.query('SELECT kind,count(*)::int AS count FROM safety_reports GROUP BY kind'),
  db.query(`SELECT id,kind,reason,status,created_at FROM safety_reports ORDER BY created_at DESC LIMIT 5`)
 ]);res.json({stats:stats.rows[0],activity:activity.rows,report_mix:reports.rows,recent_reports:recent.rows});
 }catch(error){safeError(res,error);}});
router.get('/user-filter-options',async(req,res)=>{try{const result=await db.query("SELECT DISTINCT gender,religion FROM users WHERE management_role='user'");res.json({genders:[...new Set(result.rows.map(row=>row.gender).filter(Boolean))].sort(),religions:[...new Set(result.rows.map(row=>row.religion).filter(Boolean))].sort()});}catch(error){safeError(res,error);}});
router.get('/users',async(req,res)=>{try{
 const q=typeof req.query.q==='string'?req.query.q.trim().slice(0,100):'',filter=req.query.filter||'all';
 if(!['all','active','inactive','restricted','banned','warned'].includes(filter))return res.status(400).json({error:'Invalid user filter.'});
 const parseAge=value=>value===undefined||value===''?null:typeof value==='string'&&/^\d+$/.test(value)?Number(value):NaN;
 const min=parseAge(req.query.age_min),max=parseAge(req.query.age_max),gender=req.query.gender||'',religion=req.query.religion||'';
 if([min,max].some(value=>value!==null&&(!Number.isInteger(value)||value<0||value>120))||(min!==null&&max!==null&&min>max)||typeof gender!=='string'||gender.length>60||typeof religion!=='string'||religion.length>100)return res.status(400).json({error:'Choose a valid age range from 0 to 120 and valid gender/religion filters.'});
 const values=[q,filter,min,max,gender,religion];
 const where=`u.management_role='user' AND ($1='' OR POSITION(LOWER($1) IN LOWER(COALESCE(u.real_name,'')||' '||u.email||' '||COALESCE(a.aura_name,'')))>0)
 AND ($3::int IS NULL OR u.age>=$3) AND ($4::int IS NULL OR u.age<=$4) AND ($5::text='' OR u.gender=$5) AND ($6::text='' OR u.religion=$6)
 AND ($2='all' OR ($2='active' AND EXISTS(SELECT 1 FROM user_presence p WHERE p.user_id=u.id AND p.expires_at>NOW())) OR ($2='inactive' AND NOT EXISTS(SELECT 1 FROM user_presence p WHERE p.user_id=u.id AND p.expires_at>NOW())) OR ($2='restricted' AND u.admin_restricted_until>NOW()) OR ($2='banned' AND u.banned_at IS NOT NULL) OR ($2='warned' AND EXISTS(SELECT 1 FROM account_warnings w WHERE w.user_id=u.id)))`;
 const [rows,count]=await Promise.all([db.query(`SELECT ${userFields},a.aura_name FROM users u LEFT JOIN auras a ON a.user_id=u.id WHERE ${where} ORDER BY u.created_at DESC,u.id DESC LIMIT 20 OFFSET $7`,[...values,pageOf(req)]),db.query(`SELECT count(*)::int AS total FROM users u LEFT JOIN auras a ON a.user_id=u.id WHERE ${where}`,values)]);res.json({users:rows.rows,total:count.rows[0].total});
 }catch(error){safeError(res,error);}});
router.get('/users/:id',async(req,res)=>{let client;try{
 client=await db.pool.connect();await client.query('BEGIN');const result=await client.query(`SELECT ${userFields},a.aura_name,a.bio FROM users u LEFT JOIN auras a ON a.user_id=u.id WHERE u.id=$1 AND u.management_role='user'`,[Number(req.params.id)]);
 if(!result.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'User not found.'});}
 const [warnings,usage]=await Promise.all([client.query('SELECT id,reason,created_at,acknowledged_at FROM account_warnings WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',[req.params.id]),client.query('SELECT usage_date,seconds FROM daily_app_usage WHERE user_id=$1 ORDER BY usage_date DESC LIMIT 30',[req.params.id])]);
 await audit(client,req.actor,'user_details_viewed','user',Number(req.params.id),'Management review');await client.query('COMMIT');res.json({...result.rows[0],warnings:warnings.rows,usage:usage.rows});
 }catch(error){if(client)await client.query('ROLLBACK');safeError(res,error);}finally{client?.release();}});
router.post('/users/:id/action',async(req,res)=>{
 const {action,reason,hours}=req.body||{},target=Number(req.params.id);
 if(!['warn','restrict','unrestrict','ban','unban'].includes(action)||typeof reason!=='string'||reason.trim().length<5||reason.length>1000||!Number.isInteger(target))return res.status(400).json({error:'Choose an action and provide a reason of 5–1,000 characters.'});
 if(req.actor.role==='staff'&&action!=='warn')return res.status(403).json({error:'Only admins can restrict or ban users.'});
 if(action==='restrict'&&![1,24,72,168].includes(hours))return res.status(400).json({error:'Choose 1 hour, 1 day, 3 days or 7 days.'});
 let client;try{client=await db.pool.connect();await client.query('BEGIN');
 const result=await client.query('SELECT id,management_role,banned_at,admin_restricted_until FROM users WHERE id=$1 FOR UPDATE',[target]);
 if(!result.rowCount||result.rows[0].management_role!=='user'||target===req.actor.id){await client.query('ROLLBACK');return res.status(403).json({error:'This account cannot be managed here.'});}
 const before=result.rows[0];
 if(action==='warn')await client.query('INSERT INTO account_warnings(user_id,issued_by,reason) VALUES($1,$2,$3)',[target,req.actor.id,reason.trim()]);
 if(action==='restrict')await client.query("UPDATE users SET admin_restricted_until=NOW()+$2::int*INTERVAL '1 hour',admin_restriction_reason=$3 WHERE id=$1",[target,hours,reason.trim()]);
 if(action==='unrestrict')await client.query('UPDATE users SET admin_restricted_until=NULL,admin_restriction_reason=NULL WHERE id=$1',[target]);
 if(action==='ban'){
 await client.query('UPDATE users SET banned_at=NOW(),ban_reason=$2,auth_version=auth_version+1 WHERE id=$1',[target,reason.trim()]);
 await client.query('DELETE FROM user_presence WHERE user_id=$1',[target]);await client.query("UPDATE aura_sessions SET status='ended' WHERE (user1_id=$1 OR user2_id=$1) AND status IN ('waiting','active')",[target]);
 }
 if(action==='unban')await client.query('UPDATE users SET banned_at=NULL,ban_reason=NULL,auth_version=auth_version+1 WHERE id=$1',[target]);
 await audit(client,req.actor,'user_'+action,'user',target,reason.trim(),{before:{banned:!!before.banned_at,restricted_until:before.admin_restricted_until},hours:action==='restrict'?hours:null});await client.query('COMMIT');
 if(action==='ban'){const io=req.app.get('io');if(io)for(const socket of await io.fetchSockets())if(socket.userId===target)socket.disconnect(true);}
 res.json({ok:true});
 }catch(error){if(client)await client.query('ROLLBACK');safeError(res,error);}finally{client?.release();}
});
router.get('/reports',async(req,res)=>{try{
 const kind=req.query.kind||'all',status=req.query.status||'all';if(!['all','user','post','bug'].includes(kind)||!['all','pending','reviewing','resolved','dismissed'].includes(status))return res.status(400).json({error:'Invalid report filter.'});
 const [rows,count]=await Promise.all([db.query(`SELECT r.id,r.kind,r.reason,r.status,r.created_at,r.assigned_to,a.aura_name AS reporter_name,r.reported_user_id FROM safety_reports r LEFT JOIN auras a ON a.user_id=r.reporter_id WHERE ($1='all' OR r.kind=$1) AND ($2='all' OR r.status=$2) ORDER BY r.created_at DESC LIMIT 20 OFFSET $3`,[kind,status,pageOf(req)]),db.query("SELECT count(*)::int AS total FROM safety_reports WHERE ($1='all' OR kind=$1) AND ($2='all' OR status=$2)",[kind,status])]);res.json({reports:rows.rows,total:count.rows[0].total});
 }catch(error){safeError(res,error);}});
router.get('/reports/:id',async(req,res)=>{let client;try{
 client=await db.pool.connect();await client.query('BEGIN');const result=await client.query('SELECT * FROM safety_reports WHERE id=$1',[Number(req.params.id)]);if(!result.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Report not found.'});}
 const report=result.rows[0];let evidence=null;
 if(report.kind==='post')evidence=(await client.query('SELECT id,caption,image_url,visibility,created_at,moderation_hidden_at FROM posts WHERE id=$1',[report.target_id])).rows[0]||null;
 const conversationId=report.conversation_id||(/^\/chat\/(\d+)$/.exec(report.context_path||'')?.[1]);
 if(report.kind==='user'&&conversationId){
 const member=await client.query('SELECT id FROM matches WHERE id=$1 AND (user1_id=$2 OR user2_id=$2) AND (user1_id=$3 OR user2_id=$3)',[conversationId,report.reporter_id,report.reported_user_id]);
 if(member.rowCount)evidence={messages:(await client.query('SELECT id,sender_id,content,kind,unsent_at,created_at FROM messages WHERE match_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30',[conversationId])).rows.reverse()};
 }
 if(report.kind==='user'&&report.soul_session_id){const member=await client.query('SELECT id FROM aura_sessions WHERE id=$1 AND (user1_id=$2 OR user2_id=$2) AND (user1_id=$3 OR user2_id=$3)',[report.soul_session_id,report.reporter_id,report.reported_user_id]);if(member.rowCount)evidence={messages:(await client.query('SELECT id,sender_id,content,created_at FROM aura_session_messages WHERE session_id=$1 ORDER BY created_at DESC LIMIT 30',[report.soul_session_id])).rows.reverse()};}
 await audit(client,req.actor,'report_evidence_viewed','report',Number(req.params.id),'Reported content review');await client.query('COMMIT');res.json({...report,evidence,retained_access:req.actor.role==='superadmin'||report.evidence_reviewer_id===req.actor.id});
 }catch(error){if(client)await client.query('ROLLBACK');safeError(res,error);}finally{client?.release();}});
router.patch('/reports/:id',async(req,res)=>{
 const {status,notes='',assignToMe=false}=req.body||{};if(!['pending','reviewing','resolved','dismissed'].includes(status)||typeof notes!=='string'||notes.length>2000||typeof assignToMe!=='boolean')return res.status(400).json({error:'Choose a report status and notes up to 2,000 characters.'});
 let client;try{client=await db.pool.connect();await client.query('BEGIN');const result=await client.query('SELECT status,management_notes,assigned_to FROM safety_reports WHERE id=$1 FOR UPDATE',[Number(req.params.id)]);if(!result.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Report not found.'});}
 await client.query('UPDATE safety_reports SET status=$2,management_notes=$3,assigned_to=CASE WHEN $4 THEN $5 ELSE assigned_to END,updated_at=NOW() WHERE id=$1',[req.params.id,status,notes,assignToMe,req.actor.id]);
 await audit(client,req.actor,'report_updated','report',Number(req.params.id),'Report workflow update',{before:result.rows[0],after:{status,notes,assigned_to:assignToMe?req.actor.id:result.rows[0].assigned_to}});await client.query('COMMIT');res.json({ok:true});
 }catch(error){if(client)await client.query('ROLLBACK');safeError(res,error);}finally{client?.release();}
});
router.post('/reports/:id/content-action',async(req,res)=>{
 if(req.actor.role==='staff')return res.status(403).json({error:'Only admins can moderate reported posts.'});
 const {action,reason}=req.body||{};if(!['hide_post','restore_post'].includes(action)||typeof reason!=='string'||reason.trim().length<5||reason.length>1000)return res.status(400).json({error:'Choose an action and provide a reason.'});
 let client;try{client=await db.pool.connect();await client.query('BEGIN');const report=await client.query("SELECT target_id FROM safety_reports WHERE id=$1 AND kind='post'",[Number(req.params.id)]);if(!report.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Reported post unavailable.'});}
 const post=await client.query('SELECT id,moderation_hidden_at FROM posts WHERE id=$1 FOR UPDATE',[report.rows[0].target_id]);if(!post.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'The post has been deleted.'});}
 await client.query('UPDATE posts SET moderation_hidden_at=CASE WHEN $2 THEN NOW() ELSE NULL END,moderation_reason=$3 WHERE id=$1',[post.rows[0].id,action==='hide_post',reason.trim()]);
 await audit(client,req.actor,action,'post',post.rows[0].id,reason.trim(),{report_id:Number(req.params.id),was_hidden:!!post.rows[0].moderation_hidden_at});await client.query('COMMIT');res.json({ok:true});
 }catch(error){if(client)await client.query('ROLLBACK');safeError(res,error);}finally{client?.release();}
});
router.get('/team',superOnly,async(req,res)=>{try{const result=await db.query("SELECT id,email,real_name,management_role,must_change_password,created_at FROM users WHERE management_role!='user' ORDER BY created_at,id");res.json(result.rows);}catch(error){safeError(res,error);}});
router.post('/team',superOnly,async(req,res)=>{
 const {email,name='',role,password}=req.body||{};
 if(typeof email!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof name!=='string'||name.length>100||!['admin','staff'].includes(role)||typeof password!=='string'||password.length<12||password.length>128)return res.status(400).json({error:'Provide a valid email, role and temporary password of 12–128 characters.'});
 let client;try{const hash=await bcrypt.hash(password,12);client=await db.pool.connect();await client.query('BEGIN');const existing=await client.query('SELECT id FROM users WHERE lower(email)=lower($1)',[email.trim()]);if(existing.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'This email already exists. Use the role controls for an existing account.'});}
 const result=await client.query('INSERT INTO users(email,real_name,password_hash,management_role,must_change_password) VALUES($1,$2,$3,$4,TRUE) RETURNING id',[email.trim().toLowerCase(),name.trim(),hash,role]);
 await audit(client,req.actor,'team_account_created','account',result.rows[0].id,'Management account created',{role,email:email.trim().toLowerCase()});await client.query('COMMIT');res.status(201).json({id:result.rows[0].id});
 }catch(error){if(client)await client.query('ROLLBACK');safeError(res,error);}finally{client?.release();}
});
router.patch('/team/:id',superOnly,async(req,res)=>{
 const target=Number(req.params.id),{role,reason}=req.body||{};
 if(!['user','admin','staff'].includes(role)||typeof reason!=='string'||reason.trim().length<5||reason.length>1000)return res.status(400).json({error:'Choose a role and provide a reason.'});
 let client;try{client=await db.pool.connect();await client.query('BEGIN');const result=await client.query('SELECT id,management_role,banned_at FROM users WHERE id=$1 FOR UPDATE',[target]);
 if(!result.rowCount||target===req.actor.id||result.rows[0].management_role==='superadmin'||result.rows[0].banned_at){await client.query('ROLLBACK');return res.status(403).json({error:'This account role cannot be changed here.'});}
 await client.query('UPDATE users SET management_role=$2,auth_version=auth_version+1 WHERE id=$1',[target,role]);await audit(client,req.actor,'role_changed','account',target,reason.trim(),{before:result.rows[0].management_role,after:role});await client.query('COMMIT');res.json({ok:true});
 }catch(error){if(client)await client.query('ROLLBACK');safeError(res,error);}finally{client?.release();}
});
router.get('/audit',superOnly,async(req,res)=>{try{const q=typeof req.query.q==='string'?req.query.q.slice(0,100):'';const [rows,count]=await Promise.all([db.query("SELECT * FROM management_audit WHERE $1='' OR POSITION(lower($1) IN lower(actor_email||' '||action||' '||COALESCE(reason,'')))>0 ORDER BY id DESC LIMIT 30 OFFSET $2",[q,Math.max(0,(Number(req.query.page)||1)-1)*30]),db.query("SELECT count(*)::int AS total FROM management_audit WHERE $1='' OR POSITION(lower($1) IN lower(actor_email||' '||action||' '||COALESCE(reason,'')))>0",[q])]);res.json({events:rows.rows,total:count.rows[0].total});}catch(error){safeError(res,error);}});
module.exports=router;
