import {useEffect,useState} from 'react';
import Icon from './Icon';
import api from '../api/client';

const religions=['Iglesia ni Cristo','Catholic','Born Again / Evangelical','Christian','Seventh-day Adventist',"Jehovah's Witnesses",'Mormon / Latter Day Saints','Pentecostal','Baptist','Methodist','Protestant','Muslim','Buddhist','Hindu','Jewish','Sikh','Taoist',"Baha'i",'Agnostic','Atheist','Other'];
export default function FarmingLobby({mode,setMode,filters,setFilters,onStart,loading,statusMessage}) {
  const [allowance,setAllowance]=useState(null),[error,setError]=useState(''),[clock,setClock]=useState(Date.now());
  useEffect(()=>{let live=true;const load=()=>api.get('/aura-chat/allowance').then(r=>{if(live){setAllowance(r.data);if(!r.data.premium)setFilters(f=>f.religion?{...f,religion:''}:f);setError('');}}).catch(()=>{if(live)setError('Unable to load your allowance. Refresh to retry.');});load();const timer=setInterval(()=>{setClock(Date.now());load();},30000);return()=>{live=false;clearInterval(timer);};},[]);
  const premium=allowance?.premium, expired=allowance?.resetsAt&&new Date(allowance.resetsAt)<=clock;
  const remaining=expired?(mode==='call'?3:5):allowance?.[mode==='call'?'callsRemaining':'chatsRemaining'];
  const reset=allowance?.resetsAt?new Date(allowance.resetsAt).toLocaleString():null;
  const set=(key,value)=>setFilters({...filters,[key]:value});
  return <main className="farming-lobby">
    <span className="farming-kicker">A NEW WAY TO CONNECT</span><h1>Aura Farming</h1><p className="farming-subtitle">A little curiosity. A real connection.</p>
    <div className="farming-mode-grid" aria-label="Choose a way to connect">{[['chat','Random chat','Start with a hello.','talk'],['call','Random call','Meet through a voice.','mic']].map(([value,title,description,icon])=><button type="button" key={value} className={mode===value?'selected':''} aria-pressed={mode===value} disabled={loading} onClick={()=>setMode(value)}><span className="farming-mode-icon"><Icon name={icon} size={24}/></span><strong>{title}</strong><small>{description}</small><span className="farming-mode-quota">{premium?'Unlimited with Premium':`${expired?(value==='chat'?5:3):allowance?.[value==='chat'?'chatsRemaining':'callsRemaining']??'…'} free left`}</span></button>)}</div>
    <section className="farming-filters"><header><h2>Who would you like to meet?</h2><span>Age & gender are free</span></header><div className="farming-age-row"><label>Minimum age<input type="number" min="18" max="120" placeholder="18+" value={filters.ageMin} onChange={e=>set('ageMin',e.target.value)}/></label><label>Maximum age<input type="number" min="18" max="120" placeholder="Any" value={filters.ageMax} onChange={e=>set('ageMax',e.target.value)}/></label></div><label>Gender<select value={filters.gender} onChange={e=>set('gender',e.target.value)}><option value="">Any gender</option>{['Female','Male','Nonbinary'].map(v=><option key={v}>{v}</option>)}</select></label><label>Religion <span className="farming-premium-badge">Premium</span><select disabled={!premium} value={premium?filters.religion:''} onChange={e=>set('religion',e.target.value)}><option value="">Any religion</option>{religions.map(v=><option key={v}>{v}</option>)}</select></label>{!premium&&<p className="farming-filter-note">Premium unlocks religion filters and unlimited random chats & calls.</p>}</section>
    <div className="farming-allowance"><Icon name="spark" size={18}/><p>{premium?'Your Premium access is active.':reset?`Free allowance resets ${reset}.`:'5 free chats + 3 free calls. Your 24-hour window starts at your first match.'}<small>Only a successful pairing uses an allowance. Both people must be searching and match each other’s filters.</small></p></div>
    {(statusMessage||error)&&<p role="status" className="farming-error">{statusMessage||error}</p>}
    <button className="aura-btn-primary w-full" onClick={onStart} disabled={loading||!allowance||(!premium&&remaining===0)}>{loading?'Starting…':!premium&&remaining===0?'Free allowance used · Premium required':mode==='call'?'Find a voice':'Find someone to chat'}</button>
    <p className="farming-footer">Five anonymous minutes. Reveal together after one minute.<br/>{mode==='call'?'Microphone permission is required. Calls are not recorded by AURA.':'Take your time. A good hello is enough.'}</p>
  </main>;
}
