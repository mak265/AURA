import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client';
import ReactionIcon from './ReactionIcon';
export default function ReactionList({ postId, onClose }) {
  const dialog=useRef(null),[reactions,setReactions]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;const previousFocus=document.activeElement;const element=dialog.current;element.showModal();
    api.get(`/feed/${postId}/reactions`).then(response=>{if(active)setReactions(response.data);}).catch(()=>{if(active)setError('Unable to load reactions.');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;element.close();previousFocus?.focus();};
  },[postId]);
  return createPortal(<dialog ref={dialog} className="reaction-dialog" aria-label="Post reactions" onCancel={onClose} onClick={event=>{if(event.target===dialog.current)onClose();}}>
    <div className="reaction-dialog-heading"><div><p className="eyebrow">A LITTLE APPRECIATION</p><h2>Reactions</h2></div><button onClick={onClose} aria-label="Close reactions">×</button></div>
    {loading?<p className="text-sm text-gray-400 p-5">Loading reactions…</p>:error?<p role="alert" className="text-sm text-red-400 p-5">{error}</p>:reactions.length===0?<p className="text-sm text-gray-400 p-5">Be the first to leave a reaction.</p>:<div className="p-5 space-y-5">{reactions.map(person=><div key={person.user_id} className="flex items-center gap-3"><span className="journal-avatar !w-9 !h-9 !text-base">{person.aura_name?.charAt(0) || 'A'}</span><span className="flex-1 text-sm">{person.aura_name || 'Anonymous'}</span><ReactionIcon type={person.reaction} size={30}/></div>)}</div>}
  </dialog>,document.body);
}

export function ReactionPicker({ onClose, onSelect, selected, anchor }) {
  const tray=useRef(null);
  useEffect(()=>{
    const dismiss=event=>{if(!tray.current?.contains(event.target)&&!event.target.closest('.message-removal-menu'))onClose();};
    const escape=event=>{if(event.key==='Escape')onClose();};
    document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);
    window.addEventListener('scroll',onClose,true);
    return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);window.removeEventListener('scroll',onClose,true);};
  },[onClose]);
  const width=Math.min(372,window.innerWidth-16);
  const left=Math.max(8,Math.min(anchor?.left||8,window.innerWidth-width-8));
  const top=Math.max(12,(anchor?.top||120)-88);
  return createPortal(<div ref={tray} role="toolbar" aria-label="Choose a reaction" className="floating-reactions" style={{left,top,width}}>
    {[['like','Like'],['love','Love'],['care','Care'],['haha','Haha'],['wow','Wow'],['sad','Sad'],['angry','Angry']].map(([id,label])=><button key={id} aria-label={`React ${label}`} aria-pressed={selected===id} onClick={()=>{onSelect(id);onClose();}} className="reaction-option"><ReactionIcon type={id} size={38}/><span>{label}</span></button>)}
  </div>,document.body);
}

