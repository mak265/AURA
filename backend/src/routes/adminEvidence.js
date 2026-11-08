const express=require('express'),db=require('../db');
const {audit,superOnly,safeError}=require('../management');
const {canReadRetained}=require('../reportEvidence');
const router=express.Router();
function validReason(req,res,next){const reason=req.body?.reason;if(typeof reason!=='string'||reason.trim().length<5||reason.length>1000)return res.status(400).json({error:'Give a review reason of 5–1,000 characters.'});next();}
router.post('/:id/evidence-reviewer',superOnly,validReason,async(req,res)=>{
 const reviewer=req.body.reviewerId===null?null:Number(req.body.reviewerId);if(reviewer!==null&&!Number.isInteger(reviewer))return res.status(400).json({error:'Select a management reviewer.'});
 let client;try{client=await db.pool.connect();await client.query('BEGIN');const person=await client.query("SELECT id FROM users WHERE id=$1 AND management_role IN ('staff','admin','superadmin') AND banned_at IS NULL",[reviewer]);if(reviewer!==null&&!person.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:'Select an active management account.'});}
 const report=await client.query('SELECT evidence_reviewer_id FROM safety_reports WHERE id=$1 FOR UPDATE',[Number(req.params.id)]);if(!report.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Report not found.'});}
 await client.query('UPDATE safety_reports SET evidence_reviewer_id=$2,updated_at=NOW() WHERE id=$1',[req.params.id,reviewer]);
 await audit(client,req.actor,'evidence_reviewer_assigned','report',Number(req.params.id),req.body.reason.trim(),{before:report.rows[0].evidence_reviewer_id,after:reviewer});await client.query('COMMIT');res.json({ok:true});
 }catch(error){if(client)await client.query('ROLLBACK');safeError(res,error);}finally{client?.release();}
});
async function openReport(client,req,res){
 const report=(await client.query('SELECT id,evidence_reviewer_id FROM safety_reports WHERE id=$1 FOR SHARE',[Number(req.params.id)])).rows[0];
 if(!report){res.status(404).json({error:'Report not found.'});return null;}
 if(!canReadRetained(req.actor,report)){res.status(403).json({error:'Only Superadmin or the explicitly assigned evidence reviewer can access retained messages.'});return null;}
 return report;
}
router.post('/:id/retained-evidence',validReason,async(req,res)=>{let client;try{
 client=await db.pool.connect();await client.query('BEGIN');const report=await openReport(client,req,res);if(!report){await client.query('ROLLBACK');return;}
 const result=await client.query(`SELECT e.id,e.source,e.message_id,e.sender_id,e.content,e.kind,e.duration_seconds,e.media_omitted,e.message_created_at,e.captured_at,e.expires_at,e.attachment IS NOT NULL AS has_media,
 CASE WHEN e.source='match' THEN EXISTS(SELECT 1 FROM messages m WHERE m.id=e.message_id AND m.unsent_at IS NOT NULL) ELSE FALSE END AS unsent_now
 FROM report_message_evidence e WHERE e.report_id=$1 AND e.expires_at>clock_timestamp() ORDER BY e.message_created_at,e.id`,[report.id]);
 if(!result.rowCount){await client.query('ROLLBACK');return res.status(410).json({error:'No retained evidence is available. It may have expired or was not captured when the report was submitted.'});}
 await audit(client,req.actor,'retained_evidence_viewed','report',report.id,req.body.reason.trim(),{message_count:result.rowCount});await client.query('COMMIT');res.set('Cache-Control','private, no-store');res.json({messages:result.rows,expires_at:result.rows[0].expires_at});
 }catch(error){if(client)await client.query('ROLLBACK');safeError(res,error);}finally{client?.release();}
});
router.post('/:id/retained-evidence/:evidenceId/media',validReason,async(req,res)=>{let client;try{
 client=await db.pool.connect();await client.query('BEGIN');const report=await openReport(client,req,res);if(!report){await client.query('ROLLBACK');return;}
 const evidence=(await client.query('SELECT id,attachment,attachment_mime FROM report_message_evidence WHERE id=$1 AND report_id=$2 AND expires_at>clock_timestamp() AND attachment IS NOT NULL',[Number(req.params.evidenceId),report.id])).rows[0];
 if(!evidence){await client.query('ROLLBACK');return res.status(410).json({error:'Retained media is unavailable or expired.'});}
 await audit(client,req.actor,'retained_media_viewed','report',report.id,req.body.reason.trim(),{evidence_id:evidence.id});await client.query('COMMIT');
 res.set({'Cache-Control':'private, no-store','Content-Type':evidence.attachment_mime,'Content-Disposition':'inline','X-Content-Type-Options':'nosniff'});res.send(evidence.attachment);
 }catch(error){if(client)await client.query('ROLLBACK');safeError(res,error);}finally{client?.release();}
});
module.exports=router;
