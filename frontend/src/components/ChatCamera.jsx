import { useEffect, useRef, useState } from 'react';
export default function ChatCamera({ onCapture, onClose }) {
 const video=useRef(null),stream=useRef(null),[error,setError]=useState(''),[ready,setReady]=useState(false);
 useEffect(()=>{let active=true;
  if(!navigator.mediaDevices?.getUserMedia){setError('Camera unavailable. Use Photo to select an image.');return;}
  navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false}).then(input=>{
   if(!active){input.getTracks().forEach(track=>track.stop());return;}stream.current=input;video.current.srcObject=input;
  }).catch(()=>{if(active)setError('Unable to open camera. Allow camera access, or use Photo.');});
  return()=>{active=false;stream.current?.getTracks().forEach(track=>track.stop());};
 },[]);
 const capture=()=>{const canvas=document.createElement('canvas'),v=video.current;const scale=Math.min(1,1600/Math.max(v.videoWidth,v.videoHeight));canvas.width=Math.round(v.videoWidth*scale);canvas.height=Math.round(v.videoHeight*scale);canvas.getContext('2d').drawImage(v,0,0,canvas.width,canvas.height);onCapture(canvas.toDataURL('image/jpeg',.87));};
 return <div className="chat-camera" role="dialog" aria-modal="true" aria-label="Take a photo"><div><h2>Take a photo</h2>{error?<p role="alert">{error}</p>:<video ref={video} autoPlay muted playsInline onLoadedData={()=>setReady(true)}/>}<div className="flex gap-3 mt-3"><button className="aura-btn-secondary" onClick={onClose}>Cancel</button><button className="aura-btn-primary" disabled={!ready||!!error} onClick={capture}>Capture & preview</button></div></div></div>;
}
