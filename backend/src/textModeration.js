const db=require('./db');
const HOUR=3600000;
function normalize(text){return text.normalize('NFKC').toLowerCase().replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'').replace(/[013457@$!]/g,c=>({'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a','$':'s','!':'i'}[c]));}
function tokenPattern(word){return new RegExp('(?:^|[^a-z])'+[...word].map(c=>c+'+').join('[\\W_]*')+'(?:$|[^a-z])','i');}
const strictWords=['putangina','putanginamo','tangina','gago','gaga','bobo','tanga','fuck','fucking','shit'];
const severeWords=['kantot','kantutin','kantutan','chupain','chupa','iyot','burat','pekpek','nigger','faggot'];
const strictPatterns=strictWords.map(tokenPattern),severePatterns=severeWords.map(tokenPattern);
function isViolation(text,strict=true){
 if(typeof text!=='string')return false;
 const values=[normalize(text),text.normalize('NFKC').toLowerCase().replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'')];
 return values.some(value=>check(value,strict));
}
function check(value,strict=true){
 return severePatterns.some(pattern=>pattern.test(value))||(strict&&strictPatterns.some(pattern=>pattern.test(value)))||/\b(?:i(?:ll| will| am going to)|gonna)\s+(?:kill|rape)\s+(?:you|u)\b|\b(?:papatayin|gagahasain)\s+(?:kita|ka)\b|\bsend\s+(?:me\s+)?nudes\b/i.test(value);
}
function nextState(state,violation,now){
 if(state.restricted_until&&new Date(state.restricted_until).getTime()>now)return {...state,restricted:true};
 const started=state.window_started_at&&new Date(state.window_started_at).getTime();
 const reset=!started||now-started>=HOUR||!!state.restricted_until;
 const count=(reset?0:state.violations)+(violation?1:0);
 return {window_started_at:count?new Date(reset?now:started):null,violations:count,restricted_until:count>=3?new Date(now+HOUR):null,restricted:count>=3};
}
async function enforceText(req,res,text,{strict=true}={}){return enforceViolation(req,res,isViolation(text,strict),'text');}
async function enforceViolation(req,res,violation,kind='text'){
 const account=await db.query('SELECT admin_restricted_until,admin_restriction_reason FROM users WHERE id=$1',[req.user.userId]);
 if(account.rows[0]?.admin_restricted_until&&new Date(account.rows[0].admin_restricted_until)>new Date()){res.status(403).json({code:'ADMIN_RESTRICTED',error:'Sending and posting are restricted until '+new Date(account.rows[0].admin_restricted_until).toLocaleString('en-US',{timeZone:'UTC'})+' UTC. '+(account.rows[0].admin_restriction_reason||'')});return false;}

 const client=await db.pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('INSERT INTO moderation_state(user_id) VALUES($1) ON CONFLICT DO NOTHING',[req.user.userId]);
  const {rows}=await client.query('SELECT *,clock_timestamp() AS server_now FROM moderation_state WHERE user_id=$1 FOR UPDATE',[req.user.userId]);
  const state=nextState(rows[0],violation,new Date(rows[0].server_now).getTime());
  await client.query('UPDATE moderation_state SET window_started_at=$2,violations=$3,restricted_until=$4 WHERE user_id=$1',[req.user.userId,state.window_started_at,state.violations,state.restricted_until]);
  await client.query('COMMIT');
  if(state.restricted||violation){
   const until=state.restricted_until||new Date(new Date(state.window_started_at).getTime()+HOUR);
   res.status(state.restricted?429:422).json({code:state.restricted?'TEXT_RESTRICTED':'TEXT_VIOLATION',error:state.restricted?'Sending and posting are paused for 1 hour after 3 violations. You can still read your conversations.':`Please ${kind==='image'?'choose a different image':'edit this text'} before sending. Warning ${state.violations} of 3 in the current 1-hour window.`,moderation:{count:state.violations,limit:3,resets_at:until,restricted_until:state.restricted_until}});
   return false;
  }
  return true;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
module.exports={enforceViolation,enforceText,isViolation,nextState,normalize};
