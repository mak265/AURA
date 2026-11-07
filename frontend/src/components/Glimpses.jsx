import { useEffect, useState } from 'react';
import api from '../api/client';
import Avatar from './Avatar';
import Icon from './Icon';
import GlimpseEditor from './GlimpseEditor';
import GlimpseViewer from './GlimpseViewer';
export default function Glimpses({ myId }) {
 const [items,setItems]=useState([]),[compose,setCompose]=useState(false),[active,setActive]=useState(null),[error,setError]=useState('');
 const refresh=()=>api.get('/glimpses').then(({data})=>{setItems(data);setError('');}).catch(()=>setError('Unable to load glimpses.'));
 useEffect(()=>{refresh();const timer=setInterval(refresh,30000);return()=>clearInterval(timer);},[]);
 const groups=Object.values(items.filter(item=>new Date(item.expires_at)>new Date()).reduce((all,item)=>{(all[item.user_id]??={...item,ids:[]}).ids.push(item.id);return all;},{})).sort((a,b)=>(b.user_id===myId)-(a.user_id===myId));
 const ids=groups.flatMap(group=>group.ids);
 return <section className="glimpses-section" aria-label="Glimpses"><div className="glimpses-heading"><h2>Glimpses</h2><span>A little of today · 24h</span></div><div className="glimpses-strip"><button className="glimpse-circle-item" onClick={()=>setCompose(true)}><span className="glimpse-add"><Icon name="edit" size={23}/><b>+</b></span><span>Add a glimpse</span></button>{groups.map(group=><button key={group.user_id} className="glimpse-circle-item" onClick={()=>setActive({id:group.ids[0],ids})}><span className="glimpse-ring"><Avatar src={group.profile_photo} name={group.aura_name} size={56}/></span><span>{group.user_id===myId?'Your glimpses':group.aura_name||'Aura'}</span><small>{group.ids.length} glimpse{group.ids.length===1?'':'s'}</small></button>)}</div>{error&&<p role="alert" className="text-xs text-red-500">{error}</p>}
 {compose&&<GlimpseEditor onClose={()=>setCompose(false)} onShared={()=>{setCompose(false);refresh();}}/>}
 {active&&<GlimpseViewer ids={active.ids} initialId={active.id} myId={myId} onClose={()=>setActive(null)} onDeleted={refresh}/>}
 </section>;
}
