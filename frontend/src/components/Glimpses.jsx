import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import Avatar from './Avatar';
import Icon from './Icon';
import GlimpseEditor from './GlimpseEditor';
import GlimpseViewer from './GlimpseViewer';
export default function Glimpses({ myId, targetId, onCloseTarget }) {
 const [items,setItems]=useState([]),[compose,setCompose]=useState(false),[active,setActive]=useState(() => targetId ? {id:targetId,ids:[targetId]} : null),[error,setError]=useState('');
 const refresh=()=>api.get('/glimpses').then(({data})=>{
  setItems(previous=>{
   const viewed=new Set(previous.filter(item=>item.viewed).map(item=>item.id));
   return data.map(item=>viewed.has(item.id)?{...item,viewed:true}:item);
  });
  setError('');
 }).catch(()=>setError('Unable to load glimpses.'));
 const markViewed=useCallback(id=>setItems(previous=>previous.map(item=>item.id===id?{...item,viewed:true}:item)),[]);
 useEffect(()=>{refresh();const timer=setInterval(refresh,30000);return()=>clearInterval(timer);},[]);
 const groups=Object.values(items.filter(item=>new Date(item.expires_at)>new Date()).reduce((all,item)=>{
  const group=all[item.user_id]??={...item,ids:[],unseen:[],hasViewed:false};
  group.ids.push(item.id);
  if(item.viewed)group.hasViewed=true;
  else group.unseen.push(item.id);
  return all;
 },{})).sort((a,b)=>Number(b.user_id===myId)-Number(a.user_id===myId)||Number(a.hasViewed)-Number(b.hasViewed));
 function openGroup(group) {
  const isUnseen=group.user_id!==myId&&group.unseen.length>0;
  const ids=isUnseen?groups.filter(item=>item.user_id!==myId).flatMap(item=>item.unseen):group.ids;
  setActive({id:isUnseen?group.unseen[0]:group.ids[0],ids});
 }
 return <section className="glimpses-section" aria-label="Glimpses"><div className="glimpses-heading"><h2>Glimpses</h2><span>A little of today · 24h</span></div><div className="glimpses-strip"><button className="glimpse-circle-item" onClick={()=>setCompose(true)}><span className="glimpse-add"><Icon name="edit" size={23}/><b>+</b></span><span>Add a glimpse</span></button>{groups.map(group=><button key={group.user_id} className="glimpse-circle-item" onClick={()=>openGroup(group)}><span className={group.user_id!==myId&&group.hasViewed ? "glimpse-ring glimpse-ring-viewed" : "glimpse-ring"}><Avatar src={group.profile_photo} name={group.aura_name} size={56}/></span><span>{group.user_id===myId?'Your glimpses':group.aura_name||'Aura'}</span><small>{group.user_id!==myId&&group.hasViewed ? "Viewed · " : ""}{group.ids.length} glimpse{group.ids.length===1?'':'s'}</small></button>)}</div>{error&&<p role="alert" className="text-xs text-red-500">{error}</p>}
 {compose&&<GlimpseEditor onClose={()=>setCompose(false)} onShared={()=>{setCompose(false);refresh();}}/>}
 {active&&<GlimpseViewer ids={active.ids} initialId={active.id} myId={myId} onClose={()=>{setActive(null);if(targetId)onCloseTarget?.();}} onDeleted={refresh} onViewed={markViewed}/>}
 </section>;
}
