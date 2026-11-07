import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
function Notice({ data, onClose }){
 const dialog=useRef(null),restricted=data.code==='TEXT_RESTRICTED';
 useEffect(()=>{const element=dialog.current,previous=document.activeElement;element.showModal();return()=>{element.close();if(previous?.isConnected)previous.focus();};},[]);
 return createPortal(<dialog ref={dialog} className="message-confirm-dialog" aria-labelledby="moderation-title" onCancel={onClose}><div className="message-confirm-icon"><Icon name="warning" size={25}/></div><h2 id="moderation-title">{restricted?'Take a pause':'Keep it respectful'}</h2><p>{data.error}</p><div className="message-confirm-note">{restricted?'Sending resumes':'Warnings reset'} at {new Date(data.moderation.resets_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}. {restricted?'Your account and conversations remain accessible.':'Three violations within this window pause sending and posting for one hour.'}</div><div className="message-confirm-actions"><button className="confirm-remove" autoFocus onClick={onClose}>{restricted?'Got it':'Edit my text'}</button></div></dialog>,document.body);
}
export default function ModerationNotice(){const [data,setData]=useState(null);useEffect(()=>{const show=event=>setData(event.detail);window.addEventListener('aura:moderation',show);return()=>window.removeEventListener('aura:moderation',show);},[]);return data?<Notice data={data} onClose={()=>setData(null)}/>:null;}
