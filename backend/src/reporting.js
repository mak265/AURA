const db=require('./db');
const {canViewPost}=require('./postPrivacy');
const {canSeeProfile}=require('./profileVisibility');
const reasons={user:['harassment','sexual_content','fake_profile','underage','scam','threats','other'],post:['sexual_content','harassment','hate','violence','spam','privacy','other'],bug:['login','chat','media','glimpses','layout','performance','other']};
async function submitReport(req,res){
 const body=req.body||{},kind=body.kind||'user',reason=body.reason,details=body.details??'',context=body.contextPath??null;
 if(!Object.hasOwn(reasons,kind)||!reasons[kind].includes(reason)||typeof details!=='string'||details.length>2000||(context!==null&&(typeof context!=='string'||context.length>160||!/^\/[a-zA-Z0-9/_-]*$/.test(context)))||(kind==='bug'&&details.trim().length<10))return res.status(400).json({error:kind==='bug'?'Choose a category and describe the bug in at least 10 characters (up to 2,000).':'Choose a valid report reason. Details can be up to 2,000 characters.'});
 let target=null,reported=null,client;
 try{
  if(kind==='post'){
   if(!Number.isInteger(body.postId)||!await canViewPost(body.postId,req.user.userId))return res.status(404).json({error:'Post unavailable.'});
   const post=await db.query('SELECT user_id FROM posts WHERE id=$1',[body.postId]);if(!post.rowCount)return res.status(404).json({error:'Post unavailable.'});target=body.postId;reported=post.rows[0].user_id;
  }else if(kind==='user'){
   if(body.matchId!==undefined||body.sessionId!==undefined){
    const match=body.matchId!==undefined,id=match?body.matchId:body.sessionId;if(!Number.isInteger(id))return res.status(400).json({error:'Invalid conversation.'});
    const result=await db.query(`SELECT user1_id,user2_id FROM ${match?'matches':'aura_sessions'} WHERE id=$1 AND (user1_id=$2 OR user2_id=$2)`,[id,req.user.userId]);
    if(!result.rowCount)return res.status(404).json({error:'Conversation unavailable.'});
    reported=result.rows[0].user1_id===req.user.userId?result.rows[0].user2_id:result.rows[0].user1_id;
    if(!reported)return res.status(400).json({error:'There is no partner to report yet.'});
   }else{
    reported=body.userId??body.reportedId;
    if(!Number.isInteger(reported)||!await canSeeProfile(reported,req.user.userId))return res.status(404).json({error:'User unavailable.'});
   }
   target=reported;
  }
  if(reported===req.user.userId)return res.status(400).json({error:'You cannot report yourself or your own post.'});
  client=await db.pool.connect();await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(68421002,$1::int)',[req.user.userId]);
  if(kind!=='bug'){
   const existing=await client.query("SELECT id,status FROM safety_reports WHERE reporter_id=$1 AND kind=$2 AND target_id=$3 AND status IN ('pending','reviewing')",[req.user.userId,kind,target]);
   if(existing.rowCount){await client.query('COMMIT');return res.json({...existing.rows[0],duplicate:true,message:'You already submitted a report for this item.'});}
  }
  const recent=await client.query("SELECT count(*)::int AS count FROM safety_reports WHERE reporter_id=$1 AND created_at>NOW()-INTERVAL '10 minutes'",[req.user.userId]);
  if(recent.rows[0].count>=5){await client.query('ROLLBACK');return res.status(429).json({error:'You have submitted several reports. Please wait 10 minutes before sending another.'});}
  const result=await client.query('INSERT INTO safety_reports(reporter_id,kind,target_id,reported_user_id,reason,details,context_path) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,status',[req.user.userId,kind,target,reported,reason,details.trim(),context]);
  await client.query('COMMIT');res.status(201).json({...result.rows[0],message:'Report received. Thank you for helping improve AURA.'});
 }catch(error){if(client)await client.query('ROLLBACK');console.error('Report submission failed:',error.code||'unknown');res.status(500).json({error:'Unable to submit report. Please try again.'});}finally{client?.release();}
}
module.exports={submitReport};
