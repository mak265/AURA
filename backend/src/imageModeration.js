const {Worker}=require('node:worker_threads'),path=require('node:path'),crypto=require('node:crypto');
const {parseAttachment}=require('./chatMedia');
const {enforceViolation}=require('./textModeration');
let worker,id=0,warmingUp=false;const pending=new Map(),cache=new Map();
function getWorker(){if(worker)return worker;const current=new Worker(path.join(__dirname,'imageModerationWorker.js'));worker=current;
 current.on('message',message=>{const job=pending.get(message.id);if(!job)return;clearTimeout(job.timer);pending.delete(message.id);if(!pending.size)current.unref();message.error?job.reject(new Error(message.error)):job.resolve(message.predictions);});
 const fail=(error)=>{if(worker!==current)return;worker=null;for(const job of pending.values()){clearTimeout(job.timer);job.reject(error);}pending.clear();};
 current.on('error',fail);current.on('exit',()=>fail(new Error('Image scanner worker stopped.')));current.unref();return current;}
function classifyImage(bytes, timeoutMs = 45000){const key=crypto.createHash('sha256').update(bytes).digest('hex'),saved=cache.get(key);if(saved&&saved.until>Date.now())return Promise.resolve(saved.predictions);
 if(pending.size>=6)return Promise.reject(new Error('Image scanner is busy.'));
 return new Promise((resolve,reject)=>{const current=getWorker(),jobId=++id;current.ref();const timer=setTimeout(()=>{reject(new Error('Image scan timed out.'));current.terminate();},timeoutMs);pending.set(jobId,{resolve:predictions=>{if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(key,{predictions,until:Date.now()+300000});resolve(predictions);},reject,timer});current.postMessage({id:jobId,bytes});});
}
function decision(predictions){
 if(!Array.isArray(predictions)||predictions.length!==5)throw new Error('Invalid scanner result.');
 const scores=Object.fromEntries(predictions.map(item=>[item.className,item.probability]));
 for(const name of ['Porn','Hentai','Sexy','Neutral','Drawing'])if(typeof scores[name]!=='number'||!Number.isFinite(scores[name])||scores[name]<0||scores[name]>1)throw new Error('Invalid scanner result.');
 const explicit=scores.Porn+scores.Hentai;
 return explicit>=.9?'violation':explicit>=.6?'uncertain':'allow';
}
async function enforceImage(req,res,data){
 if(!data)return true;
 if (warmingUp) {
  res.status(503).json({code:'IMAGE_SCAN_UNAVAILABLE',error:'Photo checking is starting up. Please try again shortly.'});
  return false;
 }
 let attachment;try{attachment=parseAttachment('image',data);}catch{res.status(400).json({error:'Choose a valid JPEG, PNG or WebP photo under 5 MB.'});return false;}
 let result;try{result=decision(await module.exports.classifyImage(attachment.bytes));}catch(error){console.warn('Image scanner:',error.message);res.status(503).json({code:'IMAGE_SCAN_UNAVAILABLE',error:'Unable to check this photo right now. Nothing was shared. Please try again.'});return false;}
 if(result==='uncertain'){res.status(422).json({code:'IMAGE_NEEDS_REVIEW',error:'We could not confidently approve this photo. Please choose a different image. No violation was added.'});return false;}
 return enforceViolation(req,res,result==='violation','image');
}
async function shutdown(){if(worker){const current=worker;await current.terminate();}}
async function warmup() {
 warmingUp = true;
 try {
  const image = await require('sharp')({ create: { width: 224, height: 224, channels: 3, background: '#fff' } }).png().toBuffer();
  await classifyImage(image);
 } finally {
  warmingUp = false;
 }
}
module.exports={enforceImage,classifyImage,decision,shutdown,warmup};
