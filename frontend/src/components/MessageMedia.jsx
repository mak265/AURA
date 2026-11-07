import { useDeviceSettings } from '../hooks/useDeviceSettings';
import { useEffect, useState } from 'react';
import api from '../api/client';
import PostImage from './PostImage';
export default function MessageMedia({ message, matchId }) {
  const [device]=useDeviceSettings();
  const [requested,setRequested]=useState(false);
  const [url,setUrl]=useState(''),[error,setError]=useState(false);
  useEffect(()=>{
    if(!device.autoMedia&&!requested)return;
    let active=true,objectUrl;const controller=new AbortController();
    api.get(`/matches/${matchId}/messages/${message.id}/media`,{responseType:'blob',signal:controller.signal}).then(response=>{
      if(active){objectUrl=URL.createObjectURL(response.data);setUrl(objectUrl);}
    }).catch(()=>{if(active)setError(true);});
    return()=>{active=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[message.id,matchId,device.autoMedia,requested]);
  if(!device.autoMedia&&!requested)return <button className="text-xs underline" onClick={()=>setRequested(true)}>Load {message.kind==='audio'?'voice message':'photo'}</button>;
  if(error)return <p className="text-xs">Unable to load attachment. Reopen the conversation to retry.</p>;
  if(!url)return <p className="text-xs opacity-70">Loading {message.kind==='audio'?'voice message':'photo'}…</p>;
  return message.kind==='image'?<PostImage src={url} alt="Photo message" className="rounded-lg w-full max-h-72 object-contain"/>:<div className="voice-message"><audio controls preload="metadata" src={url} aria-label="Voice message"/><span>{Math.ceil(message.duration_seconds||0)} sec voice message</span></div>;
}
