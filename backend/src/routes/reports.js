const express=require('express'),db=require('../db');
const {authenticate}=require('../middleware/auth'),{submitReport}=require('../reporting');
const router=express.Router();router.use(authenticate);
router.post('/',submitReport);
router.get('/mine',async(req,res)=>{try{const result=await db.query('SELECT id,kind,reason,status,created_at FROM safety_reports WHERE reporter_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30',[req.user.userId]);res.json(result.rows);}catch{res.status(500).json({error:'Unable to load your reports.'});}});
module.exports=router;
