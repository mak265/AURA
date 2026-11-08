const db=require('../db'),jwt=require('jsonwebtoken');
require('dotenv').config();
async function authenticate(req,res,next){
 const header=req.headers.authorization,token=header?.startsWith('Bearer ')?header.slice(7):null;
 if(!token)return res.status(401).json({error:'Access denied. No token provided.'});
 let decoded;try{decoded=jwt.verify(token,process.env.JWT_SECRET);}catch{return res.status(401).json({error:'Invalid or expired token.'});}
 try{
  const result=await db.query('SELECT id,management_role,banned_at,auth_version,must_change_password,admin_restricted_until FROM users WHERE id=$1',[decoded.userId]);
  const account=result.rows[0];if(!account)return res.status(401).json({error:'Account unavailable.'});
  if(account.banned_at)return res.status(403).json({code:'ACCOUNT_BANNED',error:'This account has been banned. Contact AURA support if you believe this is a mistake.'});
  if((decoded.version||0)!==(account.auth_version||0))return res.status(401).json({error:'Please sign in again.'});
  req.user={...decoded,role:account.management_role||'user',mustChangePassword:!!account.must_change_password};
  next();
 }catch(error){console.error('Authentication lookup failed:',error.code);res.status(503).json({error:'Account verification is temporarily unavailable.'});}
}
module.exports={authenticate};
