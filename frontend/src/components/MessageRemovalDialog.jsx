import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

export default function MessageRemovalDialog({ action, onCancel, onConfirm }) {
  const dialog=useRef(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const unsend=action==='unsend';
  useEffect(()=>{
    const previous=document.activeElement,element=dialog.current;
    element.showModal();
    return()=>{element.close();if(previous?.isConnected)previous.focus();};
  },[]);
  const confirm=async()=>{setBusy(true);setError('');try{await onConfirm(action);}catch(err){setError(err.response?.data?.error||'Unable to remove message. Please try again.');}finally{setBusy(false);}};
  return createPortal(<dialog ref={dialog} className="message-confirm-dialog" aria-labelledby="message-removal-title" aria-describedby="message-removal-description"
    onCancel={event=>{event.preventDefault();if(!busy)onCancel();}}>
    <div className="message-confirm-icon"><Icon name={unsend?'talk':'trash'} size={25}/></div>
    <h2 id="message-removal-title">{unsend?'Unsend this message?':'Delete for you?'}</h2>
    <p id="message-removal-description">{unsend?'This message will be removed for everyone in this chat. A “This message was unsent” note will remain.':'This message will disappear from your view. The other person will still have their copy.'}</p>
    <div className="message-confirm-note">{unsend?'They may have already seen or saved it. Messages already included in a report may be retained for review for up to 30 days.':'You cannot undo this action.'}</div>
    {error&&<p role="alert" className="message-confirm-error">{error}</p>}
    <div className="message-confirm-actions"><button autoFocus disabled={busy} onClick={onCancel}>Keep message</button><button disabled={busy} className="confirm-remove" onClick={confirm}>{busy?'Removing…':unsend?'Unsend':'Delete for me'}</button></div>
  </dialog>,document.body);
}
