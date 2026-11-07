import ChatCamera from './ChatCamera';
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
function toDataUrl(blob) {
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
}
export default function ChatAttachments({ onSend }) {
  const fileInput=useRef(null),recorder=useRef(null),stream=useRef(null),alive=useRef(true),clock=useRef(null),limit=useRef(null),discard=useRef(false);
  const [camera,setCamera]=useState(false);
  const [draft,setDraft]=useState(null),[recording,setRecording]=useState(false),[seconds,setSeconds]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;clearInterval(clock.current);clearTimeout(limit.current);if(recorder.current?.state==='recording')recorder.current.stop();stream.current?.getTracks().forEach(track=>track.stop());};},[]);
  useEffect(()=>()=>{if(draft?.url?.startsWith('blob:'))URL.revokeObjectURL(draft.url);},[draft]);
  const selectImage=async event=>{
    const file=event.target.files[0];if(!file)return;setError('');
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024){setError('Choose a JPEG, PNG or WebP image under 8 MB.');return;}
    setBusy(true);
    try{
      const image=await createImageBitmap(file),scale=Math.min(1,1600/Math.max(image.width,image.height)),canvas=document.createElement('canvas');
      canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
      const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);image.close();
      const media=canvas.toDataURL('image/jpeg',.87);if(alive.current)setDraft({kind:'image',media,url:media});
    }catch{if(alive.current)setError('Unable to open that image.');}finally{if(alive.current)setBusy(false);if(fileInput.current)fileInput.current.value='';}
  };
  const startRecording=async()=>{
    setError('');setBusy(true);
    try{
      if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('Voice recording is unavailable in this browser.');
      const input=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!alive.current){input.getTracks().forEach(track=>track.stop());return;}
      stream.current=input;discard.current=false;
      const type=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(mime=>MediaRecorder.isTypeSupported(mime));
      if(!type)throw new Error('This browser cannot record a supported audio format.');
      const instance=new MediaRecorder(input,{mimeType:type,audioBitsPerSecond:64000});recorder.current=instance;
      const chunks=[],started=Date.now();
      instance.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      instance.onstop=()=>{
        clearInterval(clock.current);clearTimeout(limit.current);input.getTracks().forEach(track=>track.stop());
        if(!alive.current)return;setRecording(false);
        if(discard.current)return;
        const blob=new Blob(chunks,{type:instance.mimeType.split(';')[0]});
        if(!blob.size||blob.size>10*1024*1024){setError('Unable to prepare voice message. Please try again.');return;}
        setDraft({kind:'audio',blob,url:URL.createObjectURL(blob),duration:Math.min(120,Math.max(.1,(Date.now()-started)/1000))});
      };
      instance.onerror=()=>{discard.current=true;input.getTracks().forEach(track=>track.stop());clearInterval(clock.current);clearTimeout(limit.current);if(alive.current){setRecording(false);setError('Recording interrupted. Please try again.');}};
      instance.start();setSeconds(0);setRecording(true);
      clock.current=setInterval(()=>{if(alive.current)setSeconds(Math.min(120,Math.floor((Date.now()-started)/1000)));},1000);
      limit.current=setTimeout(()=>{if(instance.state==='recording')instance.stop();},120000);
    }catch(err){stream.current?.getTracks().forEach(track=>track.stop());if(alive.current)setError(err.name==='NotAllowedError'?'Allow microphone access to record a voice message.':err.message||'Unable to access microphone.');}
    finally{if(alive.current)setBusy(false);}
  };
  const send=async()=>{
    if(!draft)return;setBusy(true);setError('');
    try{
      const media=draft.media || await toDataUrl(draft.blob);
      await onSend({kind:draft.kind,media,duration:draft.duration});
      if(alive.current)setDraft(null);
    }catch(err){if(alive.current)setError(err.response?.data?.error||'Unable to send attachment. Please try again.');}finally{if(alive.current)setBusy(false);}
  };
  return <div className="chat-attachments">
    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Choose chat image" onChange={selectImage} disabled={busy||recording}/>
    {draft?<div className="attachment-draft">{draft.kind==='image'?<img src={draft.url} alt="Image message preview"/>:<audio controls src={draft.url} aria-label="Voice message preview"/>}<div className="flex gap-3 mt-3"><button disabled={busy} onClick={()=>{setDraft(null);setError('');}} className="aura-btn-secondary !py-2 text-xs">Discard</button><button disabled={busy} onClick={send} className="aura-btn-primary !py-2 text-xs">{busy?'Sending…':draft.kind==='image'?'Send image':'Send voice message'}</button></div></div>:recording?<div className="recording-controls"><span className="recording-dot"/><span>Recording {Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span><button onClick={()=>{discard.current=true;if(recorder.current?.state==='recording')recorder.current.stop();}}>Cancel</button><button onClick={()=>{if(recorder.current?.state==='recording')recorder.current.stop();}}>Stop & preview</button></div>:<div className="attachment-tools"><button type="button" disabled={busy} onClick={()=>setCamera(true)}>Camera</button><button type="button" disabled={busy} onClick={()=>fileInput.current.click()}><Icon name="photo" size={17}/>Photo</button><button type="button" disabled={busy} onClick={startRecording}><Icon name="mic" size={17}/>Voice message</button>{busy&&<span>Preparing…</span>}</div>}
    {camera&&<ChatCamera onClose={()=>setCamera(false)} onCapture={media=>{setDraft({kind:'image',media,url:media});setCamera(false);}}/>}
    {error&&<p role="alert" className="text-xs text-red-600 mt-2">{error}</p>}
  </div>;
}
