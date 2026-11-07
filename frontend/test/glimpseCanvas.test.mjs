import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoFrame, wrapLines, paintGlimpse } from '../src/components/glimpseCanvas.js';

test('portrait crop covers the canvas at each pan extreme and zoom level',()=>{
 for(const [width,height] of [[1600,900],[900,1600],[300,1400],[500,500]])for(const zoom of [1,1.5,3])for(const x of [-1,0,1])for(const y of [-1,0,1]){
  const frame=photoFrame(width,height,zoom,x,y);
  assert.ok(frame.x<=.00001&&frame.y<=.00001);
  assert.ok(frame.x+frame.width>=719.999&&frame.y+frame.height>=1279.999);
 }
});
test('long text and explicit newlines wrap within the exported frame',()=>{
 const ctx={measureText:text=>({width:text.length*10})};
 const lines=wrapLines(ctx,'abcdefghij\nhello world',40);
 assert.ok(lines.every(line=>line.length<=4));
 assert.equal(lines.join(''),'abcdefghijhello world');
});
test('preview/export painter composites background, crop, text and sticker in order',()=>{
 const calls=[],ctx={createLinearGradient:()=>({addColorStop(){}}),fillRect:()=>calls.push('background'),drawImage:(_,x,y,w,h)=>calls.push(['photo',x,y,w,h]),save(){},restore(){},measureText:text=>({width:text.length*20}),fillText:(text,x,y)=>calls.push([text,x,y])};
 const canvas={getContext:()=>ctx};
 paintGlimpse(canvas,{image:{width:1600,height:900},layers:[{kind:'text',text:'Hello',x:.5,y:.4,size:54},{kind:'sticker',text:'💜',x:.5,y:.7,size:100}]});
 assert.equal(canvas.width,720);assert.equal(canvas.height,1280);
 assert.equal(calls[0],'background');assert.equal(calls[1][0],'photo');
 assert.deepEqual(calls[2],['Hello',360,512]);assert.deepEqual(calls[3],['💜',360,896]);
});
