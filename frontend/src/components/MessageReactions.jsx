import MessageRemovalDialog from './MessageRemovalDialog';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { ReactionPicker } from './ReactionList';
import ReactionIcon from './ReactionIcon';

export default function MessageReactions({ message, myId, onReact, onRemove, children, className }) {
  const timer=useRef(null),origin=useRef(null),bubble=useRef(null);
  const [confirmAction,setConfirmAction]=useState(null);
  const [anchor,setAnchor]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const clear=()=>clearTimeout(timer.current);
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  const open=()=>{clear();setAnchor(bubble.current.getBoundingClientRect());};
  const react=async type=>{if(saving)return;setSaving(true);setError('');try{await onReact(message.id,type);}catch{setError('Unable to react. Try again.');}finally{setSaving(false);}};
  const remove=async action=>{await onRemove(message.id,action);setConfirmAction(null);};
  const askRemove=action=>{setAnchor(null);setConfirmAction(action);};
  const deadline=Math.min(new Date(message.created_at).getTime()+600000,message.read_at?new Date(message.read_at).getTime()+300000:Infinity);
  const canUnsend=message.sender_id===myId&&!message.unsent_at&&Date.now()<deadline;
  const reactions=message.reactions||[];
  const mine=reactions.find(item=>item.user_id===myId)?.reaction;
  const types=[...new Set(reactions.map(item=>item.reaction))];
  return <div className="message-reaction-wrap max-w-[70%]">
    <div ref={bubble} className={className} onPointerDown={event=>{if(event.button!==0||event.target.closest('button,audio,input'))return;origin.current={x:event.clientX,y:event.clientY};timer.current=setTimeout(open,450);}}
      onPointerMove={event=>{if(origin.current&&Math.hypot(event.clientX-origin.current.x,event.clientY-origin.current.y)>12)clear();}}
      onPointerUp={clear} onPointerCancel={clear} onPointerLeave={clear} onContextMenu={event=>{event.preventDefault();open();}}>{children}</div>
    <button className="message-react-trigger" aria-label="React to message" onClick={open}>♡</button>
    {reactions.length>0&&<button className={`message-reaction-badge ${mine?'own-reaction':''}`} aria-label={`${reactions.length} message reactions. Change your reaction`} onClick={open}>{types.map(type=><ReactionIcon key={type} type={type} size={19}/>)}<span>{reactions.length}</span></button>}
    {error&&<p role="alert" className="text-xs text-red-500">{error}</p>}
    {anchor&&!message.unsent_at&&<ReactionPicker anchor={anchor} selected={mine} onSelect={react} onClose={()=>setAnchor(null)}/>}
    {anchor&&createPortal(<div className="message-removal-menu" style={{left:Math.max(8,Math.min(anchor.left,window.innerWidth-240)),top:Math.min(window.innerHeight-110,anchor.bottom+8)}}>{canUnsend&&<button disabled={saving} onClick={()=>askRemove('unsend')}>Unsend for everyone</button>}<button disabled={saving} onClick={()=>askRemove('delete_for_me')}>Delete for me</button><button onClick={()=>setAnchor(null)}>Cancel</button></div>,document.body)}
    {confirmAction&&<MessageRemovalDialog action={confirmAction} onCancel={()=>setConfirmAction(null)} onConfirm={remove}/>}
  </div>;
}
