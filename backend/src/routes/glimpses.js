const { enforceImage } = require('../imageModeration');
const { enforceText } = require('../textModeration');
const {profileVisibleSql}=require('../profileVisibility');
const express=require('express'),db=require('../db');
const {authenticate}=require('../middleware/auth');
const {visiblePostSql}=require('../postPrivacy');
const router=express.Router();router.use(authenticate);
const visible=`g.expires_at>NOW() AND ${visiblePostSql('g','$1',false)}`;
router.get('/',async(req,res)=>{try{
 const result=await db.query(`SELECT g.id,g.user_id,g.created_at,g.expires_at,g.visibility,a.aura_name,
 CASE WHEN g.user_id=$1 OR EXISTS(SELECT 1 FROM matches m WHERE m.revealed AND ((m.user1_id=$1 AND m.user2_id=g.user_id) OR (m.user2_id=$1 AND m.user1_id=g.user_id))) THEN u.profile_photo ELSE NULL END AS profile_photo
 FROM glimpses g JOIN users u ON u.id=g.user_id LEFT JOIN auras a ON a.user_id=g.user_id WHERE ${visible} ORDER BY g.created_at ASC,g.id ASC`,[req.user.userId]);res.json(result.rows);
}catch(error){console.error(error);res.status(500).json({error:'Unable to load glimpses.'});}});
router.get('/:id',async(req,res)=>{try{const result=await db.query(`SELECT g.*,a.aura_name,(SELECT reaction FROM glimpse_views v WHERE v.glimpse_id=g.id AND v.user_id=$1) AS my_reaction FROM glimpses g LEFT JOIN auras a ON a.user_id=g.user_id WHERE g.id=$2 AND ${visible}`,[req.user.userId,Number(req.params.id)]);if(!result.rowCount)return res.status(404).json({error:'This glimpse has expired or is unavailable.'});res.json(result.rows[0]);}catch{res.status(500).json({error:'Unable to open glimpse.'});}});
// Explicit view receipt: sent only after the glimpse has rendered in a visible tab.
router.post('/:id/view',async(req,res)=>{try{
 const result=await db.query(`INSERT INTO glimpse_views(glimpse_id,user_id) SELECT g.id,$1 FROM glimpses g WHERE g.id=$2 AND g.user_id!=$1 AND ${visible} ON CONFLICT(glimpse_id,user_id) DO NOTHING RETURNING glimpse_id`,[req.user.userId,Number(req.params.id)]);
 // Do not expose whether an inaccessible glimpse exists.
 if(!result.rowCount){const allowed=await db.query(`SELECT g.id FROM glimpses g WHERE g.id=$2 AND ${visible}`,[req.user.userId,Number(req.params.id)]);if(!allowed.rowCount)return res.status(404).json({error:'Glimpse unavailable.'});}
 res.json({ok:true});
}catch{res.status(500).json({error:'Unable to record view.'});}});
router.post('/:id/reaction',async(req,res)=>{
 const {reaction}=req.body;if(!['like','love','care','haha','wow','sad','angry'].includes(reaction))return res.status(400).json({error:'Choose a valid reaction.'});
 try{const result=await db.query(`INSERT INTO glimpse_views(glimpse_id,user_id,reaction) SELECT g.id,$1,$3 FROM glimpses g WHERE g.id=$2 AND g.user_id!=$1 AND ${visible}
 ON CONFLICT(glimpse_id,user_id) DO UPDATE SET reaction=CASE WHEN glimpse_views.reaction=EXCLUDED.reaction THEN NULL ELSE EXCLUDED.reaction END RETURNING reaction`,[req.user.userId,Number(req.params.id),reaction]);if(!result.rowCount)return res.status(404).json({error:'Glimpse unavailable.'});res.json(result.rows[0]);}catch{res.status(500).json({error:'Unable to react.'});}
});
router.get('/:id/activity',async(req,res)=>{try{
 const own=await db.query('SELECT id FROM glimpses WHERE id=$1 AND user_id=$2 AND expires_at>NOW()',[Number(req.params.id),req.user.userId]);if(!own.rowCount)return res.status(404).json({error:'Glimpse unavailable.'});
 const result=await db.query(`SELECT v.user_id,v.viewed_at,v.reaction,
 CASE WHEN ${profileVisibleSql('v.user_id','$2')} THEN a.aura_name ELSE 'Private member' END AS aura_name,
 CASE WHEN EXISTS(SELECT 1 FROM matches m WHERE m.revealed AND ((m.user1_id=$2 AND m.user2_id=v.user_id) OR (m.user2_id=$2 AND m.user1_id=v.user_id))) AND ${profileVisibleSql('v.user_id','$2')} THEN u.profile_photo ELSE NULL END AS profile_photo
 FROM glimpse_views v JOIN users u ON u.id=v.user_id LEFT JOIN auras a ON a.user_id=v.user_id
 WHERE v.glimpse_id=$1 ORDER BY v.viewed_at DESC`,[Number(req.params.id),req.user.userId]);
 res.json({view_count:result.rowCount,reaction_count:result.rows.filter(row=>row.reaction).length,viewers:result.rows});
}catch(error){console.error(error);res.status(500).json({error:'Unable to load viewers.'});}});
router.post('/',async(req,res)=>{
 const {caption='',image_url=null,visibility='connections'}=req.body;
 if(typeof caption!=='string'||caption.length>500||!['public','connections'].includes(visibility)||(!caption.trim()&&!image_url)|| (image_url!==null&&(typeof image_url!=='string'||image_url.length>6*1024*1024||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(image_url))))return res.status(400).json({error:'Add text or a valid photo and choose an audience.'});
 if(req.body.moderation_text!==undefined&&(typeof req.body.moderation_text!=='string'||req.body.moderation_text.length>4000))return res.status(400).json({error:'Invalid glimpse text.'});
 try{if(!await enforceText(req,res,caption+' '+(req.body.moderation_text||'')))return;if(!await enforceImage(req,res,image_url))return;const result=await db.query('INSERT INTO glimpses(user_id,caption,image_url,visibility) VALUES($1,$2,$3,$4) RETURNING id,expires_at',[req.user.userId,caption.trim(),image_url,visibility]);res.status(201).json(result.rows[0]);}catch{res.status(500).json({error:'Unable to share glimpse.'});}
});
router.delete('/:id',async(req,res)=>{try{const result=await db.query('DELETE FROM glimpses WHERE id=$1 AND user_id=$2 RETURNING id',[Number(req.params.id),req.user.userId]);if(!result.rowCount)return res.status(404).json({error:'Glimpse not found.'});res.json({ok:true});}catch{res.status(500).json({error:'Unable to delete glimpse.'});}});
module.exports=router;
