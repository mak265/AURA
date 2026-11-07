const {parentPort}=require('node:worker_threads');
const tf=require('@tensorflow/tfjs'),{load}=require('nsfwjs/core'),{MobileNetV2Model}=require('nsfwjs/models/mobilenet_v2'),sharp=require('sharp');
let model;
async function classify(bytes){
 model ||= await load('MobileNetV2',{modelDefinitions:[MobileNetV2Model]});
 let tensor;
 try{
  const {data,info}=await sharp(Buffer.from(bytes),{limitInputPixels:20000000,animated:false,failOn:'error'}).rotate().resize(224,224,{fit:'cover'}).flatten({background:'#ffffff'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  if(info.channels!==3)throw new Error('Invalid image channels');
  tensor=tf.tensor3d(new Uint8Array(data),[info.height,info.width,3],'int32');
  return await model.classify(tensor);
 }finally{tensor?.dispose();}
}
let queue=Promise.resolve();parentPort.on('message',({id,bytes})=>{queue=queue.then(async()=>{try{parentPort.postMessage({id,predictions:await classify(bytes)});}catch{parentPort.postMessage({id,error:'Unable to scan this image.'});}});});
