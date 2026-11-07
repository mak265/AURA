import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client';
import Avatar from './Avatar';
import ReactionIcon from './ReactionIcon';
function ActivitySheet({ activity, error, onClose }) {
 const dialog=useRef(null),[tab,setTab]=useState('views');
 useEffect(()=>{const element=dialog.current,previous=document.activeElement;element.showModal();return()=>{element.close();if(previous?.isConnected)previous.focus();};},[]);
 const viewers=(activity?.viewers||[]).filter(person=>tab==='views'||person.reaction);
 return createPortal(<dialog ref={dialog} className="glimpse-activity-sheet" aria-label="Glimpse viewers and reactions" onCancel={onClose}><header><div><h2>Your glimpse</h2><p>Only you can see this list</p></div><button aria-label="Close viewers" onClick={onClose}>×</button></header><nav aria-label="Glimpse activity"><button aria-pressed={tab==='views'} onClick={()=>setTab('views')}>Viewers · {activity?.view_count||0}</button><button aria-pressed={tab==='reactions'} onClick={()=>setTab('reactions')}>Reactions · {activity?.reaction_count||0}</button></nav>{error?<p role="alert">{error}</p>:!activity?<p>Loading viewers…</p>:!viewers.length?<div className="glimpse-activity-empty">{tab==='views'?'No viewers yet. Your moment is waiting.':'No reactions yet.'}</div>:<div className="glimpse-viewer-list">{viewers.map(person=><div key={person.user_id}><Avatar src={person.profile_photo} name={person.aura_name||'Aura'} size={38}/><div><strong>{person.aura_name||'Aura'}</strong><small>{new Date(person.viewed_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small></div>{person.reaction&&<span aria-label={`Reacted ${person.reaction}`}><ReactionIcon type={person.reaction} size={30}/></span>}</div>)}</div>}</dialog>,document.body);
}
export default function GlimpseActivity({ glimpseId, onOpenChange }) {
 const [activity,setActivity]=useState(null),[error,setError]=useState(''),[open,setOpen]=useState(false);
 useEffect(()=>{let live=true;const refresh=()=>api.get(`/glimpses/${glimpseId}/activity`).then(({data})=>{if(live){setActivity(data);setError('');}}).catch(()=>{if(live)setError('Unable to load viewers. Please reopen the list.');});refresh();const timer=setInterval(refresh,5000);return()=>{live=false;clearInterval(timer);};},[glimpseId]);
 const toggle=value=>{setOpen(value);onOpenChange(value);};
 return <><button className="glimpse-activity-open" aria-label="View glimpse viewers and reactions" onClick={()=>toggle(true)}><span>◉ {activity?.view_count||0}</span><span>{activity?.reaction_count||0} reactions</span></button>{open&&<ActivitySheet activity={activity} error={error} onClose={()=>toggle(false)}/>}</>;
}
