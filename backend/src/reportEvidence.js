const db=require('./db');
const MEDIA_LIMIT=10*1024*1024;
async function captureReportEvidence(client,report,reporterId,{matchId,sessionId}){
 if(!matchId&&!sessionId)return;
 const source=matchId?'match':'soul';
 const result=await client.query(matchId?`SELECT msg.id,msg.sender_id,msg.content,msg.kind,octet_length(msg.attachment) AS attachment_size,msg.attachment_mime,msg.duration_seconds,msg.created_at
 FROM messages msg WHERE msg.match_id=$1 AND msg.unsent_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM hidden_messages h WHERE h.message_id=msg.id AND h.user_id=$2)
 AND NOT EXISTS(SELECT 1 FROM conversation_preferences cp WHERE cp.match_id=$1 AND cp.user_id=$2 AND msg.created_at<=cp.deleted_at)
 ORDER BY msg.created_at DESC,msg.id DESC LIMIT 30 FOR SHARE OF msg`:
 `SELECT id,sender_id,content,'text' AS kind,created_at FROM aura_session_messages WHERE session_id=$1 AND $2::int IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 30 FOR SHARE`,[matchId||sessionId,reporterId]);
 let bytes=0;
 for(const message of result.rows){
  const size=Number(message.attachment_size)||0,include=size>0&&bytes+size<=MEDIA_LIMIT;
  let attachment=null;
  if(include){attachment=(await client.query('SELECT attachment FROM messages WHERE id=$1',[message.id])).rows[0].attachment;bytes+=size;}
  await client.query(`INSERT INTO report_message_evidence(report_id,source,message_id,sender_id,content,kind,attachment,attachment_mime,duration_seconds,media_omitted,message_created_at,expires_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz+INTERVAL '30 days') ON CONFLICT DO NOTHING`,[report.id,source,message.id,message.sender_id,message.content||'',message.kind||'text',attachment,include?message.attachment_mime:null,message.duration_seconds||null,size>0&&!include,message.created_at,report.created_at]);
 }
}
async function purgeExpiredEvidence(){return db.query('DELETE FROM report_message_evidence WHERE expires_at<=clock_timestamp()');}
function startEvidenceCleanup(){const run=()=>purgeExpiredEvidence().catch(error=>console.error('Evidence cleanup failed:',error.code||'unknown'));run();const timer=setInterval(run,60000);timer.unref();return timer;}
function canReadRetained(actor,report){return actor.role==='superadmin'||report.evidence_reviewer_id===actor.id;}
module.exports={captureReportEvidence,purgeExpiredEvidence,startEvidenceCleanup,canReadRetained};
