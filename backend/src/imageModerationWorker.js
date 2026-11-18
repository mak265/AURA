const {parentPort}=require('node:worker_threads');
const path = require('node:path');
const tf=require('@tensorflow/tfjs'),{load}=require('nsfwjs/core'),{MobileNetV2Model}=require('nsfwjs/models/mobilenet_v2'),sharp=require('sharp');
require('@tensorflow/tfjs-backend-wasm');
// This worker processes one image at a time on a single-vCPU server.
tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false);
const modelDir = path.resolve(path.dirname(require.resolve('nsfwjs/core')), '../models/mobilenet_v2');
const modelDefinition = {
 ...MobileNetV2Model,
 // The bundled loader wraps the base64 string as a module and enumerates millions of characters.
 weightBundles: [async () => ({ default: require(path.join(modelDir, 'group1-shard1of1.min.js')) })],
};
let model;
async function classify(bytes){
 if (!model) {
  if (!await tf.setBackend('wasm')) throw new Error('Unable to initialize the image scanner backend.');
  model = await load('MobileNetV2',{modelDefinitions:[modelDefinition]});
 }
 let tensor;
 try{
  const {data,info}=await sharp(Buffer.from(bytes),{limitInputPixels:20000000,animated:false,failOn:'error'}).rotate().resize(224,224,{fit:'cover'}).flatten({background:'#ffffff'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  if(info.channels!==3)throw new Error('Invalid image channels');
  tensor=tf.tensor3d(new Uint8Array(data),[info.height,info.width,3],'int32');
  return await model.classify(tensor);
 }finally{tensor?.dispose();}
}
let queue=Promise.resolve();parentPort.on('message',({id,bytes})=>{queue=queue.then(async()=>{try{parentPort.postMessage({id,predictions:await classify(bytes)});}catch(error){parentPort.postMessage({id,error:error.message});}});});
