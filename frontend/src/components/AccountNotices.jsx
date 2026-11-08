import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
function Warning({notice,onDone}){const dialog=useRef(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);useEffect(()=>{const element=dialog.current;element.showModal();return()=>element.close();},[]);const acknowledge=async()=>{setBusy(true);try{await api.post('/profile/warnings/'+notice.id+'/acknowledge');onDone();}catch{setError('Unable to acknowledge this notice. Try again.');}finally{setBusy(false);}};return createPortal(<dialog ref={dialog} className="message-confirm-dialog" aria-label="Account warning" onCancel={event=>event.preventDefault()}><h2>Account warning</h2><p>{notice.reason}</p><div className="message-confirm-note">{new Date(notice.created_at).toLocaleString()}</div>{error&&<p role="alert">{error}</p>}<div className="message-confirm-actions"><button className="confirm-remove" disabled={busy} onClick={acknowledge}>{busy?'Saving…':'I understand'}</button></div></dialog>,document.body);}
export default function AccountNotices(){
 const {user}=useAuth(),userId=user?.user?.id,[state,setState]=useState({owner:null,items:[]});
 useEffect(()=>{if(!userId)return;let live=true;const refresh=()=>{if(!document.hidden)api.get('/profile/warnings').then(({data})=>{if(live)setState({owner:userId,items:data});}).catch(()=>{});};refresh();const timer=setInterval(refresh,30000);return()=>{live=false;clearInterval(timer);};},[userId]);
 return userId&&state.owner===userId&&state.items[0]?<Warning key={state.items[0].id} notice={state.items[0]} onDone={()=>setState(previous=>({...previous,items:previous.items.slice(1)}))}/>:null;
}
