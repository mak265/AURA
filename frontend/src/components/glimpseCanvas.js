export const GLIMPSE_WIDTH=720;
export const GLIMPSE_HEIGHT=1280;
export const backgrounds=[['Lavender','#a776dc','#e5c8ee'],['Rose','#d978a7','#f4c6bc'],['Ocean','#557cce','#aed9e9'],['Midnight','#29213e','#69558b'],['Cream','#edc589','#fff0d6']];
export function photoFrame(width,height,zoom=1,x=0,y=0){
 const scale=Math.max(GLIMPSE_WIDTH/width,GLIMPSE_HEIGHT/height)*zoom;
 const w=width*scale,h=height*scale;
 return {width:w,height:h,x:(GLIMPSE_WIDTH-w)/2+x*(w-GLIMPSE_WIDTH)/2,y:(GLIMPSE_HEIGHT-h)/2+y*(h-GLIMPSE_HEIGHT)/2};
}
export function wrapLines(context,text,maxWidth){
 const lines=[];
 for(const paragraph of text.split('\n')){
  let line='';for(const char of paragraph){if(line&&context.measureText(line+char).width>maxWidth){lines.push(line);line=char;}else line+=char;}lines.push(line);
 }
 return lines;
}
export function paintGlimpse(canvas,{image,background=0,zoom=1,pan={x:0,y:0},layers=[]}){
 canvas.width=GLIMPSE_WIDTH;canvas.height=GLIMPSE_HEIGHT;
 const ctx=canvas.getContext('2d'),colors=backgrounds[background];
 const gradient=ctx.createLinearGradient(0,0,GLIMPSE_WIDTH,GLIMPSE_HEIGHT);gradient.addColorStop(0,colors[1]);gradient.addColorStop(1,colors[2]);ctx.fillStyle=gradient;ctx.fillRect(0,0,GLIMPSE_WIDTH,GLIMPSE_HEIGHT);
 if(image){const frame=photoFrame(image.width,image.height,zoom,pan.x,pan.y);ctx.drawImage(image,frame.x,frame.y,frame.width,frame.height);}
 for(const layer of layers){
  ctx.save();const fontSize=layer.size||54;ctx.font=`${layer.kind==='sticker'?'': '700 '}${fontSize}px ${layer.kind==='sticker'?'"Apple Color Emoji", "Segoe UI Emoji", sans-serif':'sans-serif'}`;
  const lines=layer.kind==='sticker'?[layer.text]:wrapLines(ctx,layer.text,600);
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=layer.color||'#fff';ctx.shadowColor='#1f123a66';ctx.shadowBlur=8;ctx.shadowOffsetY=2;
  const lineHeight=fontSize*1.25;lines.forEach((line,index)=>ctx.fillText(line,layer.x*GLIMPSE_WIDTH,layer.y*GLIMPSE_HEIGHT+(index-(lines.length-1)/2)*lineHeight));ctx.restore();
 }
}
