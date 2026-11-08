import ReportButton from './ReportButton';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
export function ConversationPressable({ onOpen, onMenu, children }) {
  const timer=useRef(null),held=useRef(false),start=useRef(null);
  const clear=()=>{clearTimeout(timer.current);timer.current=null;};
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  return <div role="button" tabIndex={0} className="conversation-row" style={{touchAction:'pan-y',WebkitTouchCallout:'none',userSelect:'none'}}
    onPointerDown={event=>{if(event.button!==0)return;held.current=false;start.current={x:event.clientX,y:event.clientY};timer.current=setTimeout(()=>{held.current=true;onMenu();},450);}}
    onPointerMove={event=>{if(start.current&&Math.hypot(event.clientX-start.current.x,event.clientY-start.current.y)>12)clear();}}
    onPointerUp={()=>{const pending=!!timer.current;clear();if(pending&&!held.current)onOpen();}}
    onPointerCancel={clear} onPointerLeave={clear} onContextMenu={event=>{event.preventDefault();clear();held.current=true;onMenu();}}
    onClick={event=>{if(event.detail===0&&!held.current)onOpen();}}
    onKeyDown={event=>{if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();onMenu();}else if(event.key==='Enter'||event.key===' '){event.preventDefault();onOpen();}}}>
    {children}<button aria-label="Conversation options" className="conversation-options" onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();onMenu();}}>···</button>
  </div>;
}
export default function ConversationMenu({ conversation, onClose, onAction }) {
  const dialog=useRef(null),[confirm,setConfirm]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const previous=document.activeElement,element=dialog.current;element.showModal();return()=>{element.close();if(previous?.isConnected)previous.focus();};},[]);
  const run=async action=>{setBusy(true);setError('');try{await onAction(action);onClose();}catch(err){setError(err.response?.data?.error||'Unable to update conversation.');}finally{setBusy(false);}};
  const choose=action=>{
    if(action==='block'||action==='delete')setConfirm(action);else run(action);
  };
  const items=[
    [conversation.pinned?'unpin':'pin','pin',conversation.pinned?'Unpin':'Pin conversation'],
    [conversation.archived?'unarchive':'archive','archive',conversation.archived?'Move to inbox':'Archive'],
    [conversation.muted?'unmute':'mute','mute',conversation.muted?'Unmute':'Mute'],
    [conversation.high_risk?'clear_risk':'high_risk','warning',conversation.high_risk?'Remove high-risk warning':'Mark as high risk'],
    [conversation.blocked_by_me?'unblock':'block','block',conversation.blocked_by_me?'Unblock':'Block'],
    ['delete','trash','Delete conversation'],
  ];
  return createPortal(<dialog ref={dialog} className="conversation-menu" aria-label="Conversation options" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <header><h2>{confirm?(confirm==='block'?'Block this person?':'Delete conversation?'):conversation.aura_name || 'Conversation'}</h2><button onClick={onClose} disabled={busy} aria-label="Close conversation options">×</button></header>
    {confirm?<div className="px-5 pb-5"><p className="text-sm text-gray-500 leading-relaxed">{confirm==='block'?'They will not be able to message you. You can unblock them later.':'Removes the conversation and its current history from your inbox only. The other person keeps their copy. A new message can bring the conversation back.'}</p><div className="flex gap-3 mt-5"><button disabled={busy} className="aura-btn-secondary !py-3 text-sm" onClick={()=>setConfirm(null)}>Cancel</button><button disabled={busy} className="aura-btn-primary !py-3 text-sm" onClick={()=>run(confirm)}>{busy?'Updating…':confirm==='block'?'Block':'Delete'}</button></div></div>:<div className="conversation-menu-items">{items.map(([action,icon,label])=><button key={action} disabled={busy} onClick={()=>choose(action)} className={action==='delete'||action==='block'?'destructive':''}><Icon name={icon} size={19}/><span>{label}</span>{action==='mute'&&<small>No unread badges</small>}</button>)}<ReportButton matchId={Number(conversation.id)}/><p>Pin, archive, mute, and risk warnings are visible only to you.</p></div>}
    {error&&<p role="alert" className="text-xs text-red-600 px-5 pb-4">{error}</p>}
  </dialog>,document.body);
}
