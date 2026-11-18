import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
export default function AuraRequestButton({ postId, authorName, matchId, canChat }) {
  const navigate=useNavigate();
  const [open,setOpen]=useState(false),[message,setMessage]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(false),[connection,setConnection]=useState(null);
  const go=()=>navigate((connection?.canChat ?? canChat)?`/chat/${connection?.matchId || matchId}`:`/aura-chat/${connection?.matchId || matchId}`);
  const send=async event=>{
    event.preventDefault();if(saving||!message.trim())return;setSaving(true);setError('');
    try{const response=await api.post('/aura-requests',{postId,message});if(response.data.status==='connected'){setConnection(response.data);setOpen(false);}else{setSent(true);setOpen(false);}}
    catch(err){setError(err.response?.data?.error||'Unable to send request.');}finally{setSaving(false);}
  };
  return <div className="px-4 pb-4">
    {matchId||connection?<button onClick={go} className="aura-btn-secondary !py-2 text-xs">Message</button>:sent?<p role="status" className="text-xs text-aura-violet-light">Aura sent · Waiting for them to accept your message request.</p>:<>
      <button type="button" onClick={()=>{setOpen(value=>!value);setError('');}} className="aura-btn-secondary !py-2 text-xs" aria-expanded={open} disabled={saving}>
        {open?'Cancel request':'Send Aura about this post'}
      </button>
      {open&&<form onSubmit={send} className="mt-3 space-y-3">
        <label className="block text-xs text-gray-400">
          Opening message{authorName ? ` to ${authorName}` : ''}
          <textarea className="aura-input mt-2 resize-none" rows={3} maxLength={1000} value={message} onChange={e=>setMessage(e.target.value)} placeholder="What caught your interest in this post?" disabled={saving} required/>
        </label>
        <p className="text-xs text-gray-400">They’ll see your opener and a preview of this post in Message requests. Chat opens after they accept.</p>
        <button className="aura-btn-primary !py-2 text-xs" disabled={saving||!message.trim()}>{saving?'Sending…':'Send Aura'}</button>
      </form>}
    </>}
    {error&&<p role="alert" className="text-xs text-red-400 mt-2">{error}</p>}
  </div>;
}
