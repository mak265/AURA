const db=require('./db');
async function audit(client,actor,action,targetType,targetId,reason,changes={}){
 await client.query('INSERT INTO management_audit(actor_id,actor_email,action,target_type,target_id,reason,changes) VALUES($1,$2,$3,$4,$5,$6,$7)',[actor.id,actor.email,action,targetType,targetId,reason||null,JSON.stringify(changes)]);
}
async function requireManagement(req,res,next){
 if(!['staff','admin','superadmin'].includes(req.user.role))return res.status(403).json({error:'Management access required.'});
 if(req.user.mustChangePassword&&!['/me','/password'].includes(req.path))return res.status(403).json({code:'PASSWORD_CHANGE_REQUIRED',error:'Change your temporary password first.'});
 try{const result=await db.query('SELECT id,email,management_role FROM users WHERE id=$1',[req.user.userId]);if(!result.rows[0]||!['staff','admin','superadmin'].includes(result.rows[0].management_role))return res.status(403).json({error:'Management access required.'});req.actor={id:result.rows[0].id,email:result.rows[0].email,role:result.rows[0].management_role};next();}catch{res.status(503).json({error:'Unable to verify management access.'});}
}
const superOnly=(req,res,next)=>req.actor.role==='superadmin'?next():res.status(403).json({error:'Superadmin access required.'});
const safeError=(res,error)=>{console.error('Management operation failed:',error.code||error.name);res.status(500).json({error:'Unable to complete management operation.'});};
module.exports={audit,requireManagement,superOnly,safeError};
