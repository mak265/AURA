import RedeemPremiumCode from '../components/RedeemPremiumCode';
import NotificationSettings from '../components/NotificationSettings';
import DeleteAccountButton from '../components/DeleteAccountButton';
import LogoutButton from '../components/LogoutButton';
import AccountSessions from '../components/AccountSessions';
import ReportButton from '../components/ReportButton';
import WorkStatusOptions from '../components/WorkStatusOptions';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useDeviceSettings } from '../hooks/useDeviceSettings';
const sections=[['redeem','spark','Redeem code','Claim AURA Premium with a giveaway code','#a88bc8'],['account','profile','Account','Profile, Aura name, bio','#6ca6ee'],['general','filters','General Settings','Theme, wallpaper, keyboard','#e6ac53'],['notifications','spark','Notifications','Unread badges','#e9898f'],['privacy','lock','Privacy and Security','Active status, private dating, blocked users','#a88bc8'],['data','photo','Data and Storage','Media download, device preferences','#79b69b']];
function Toggle({ title, description, value, onChange, disabled=false }){return <div className="settings-toggle-row"><div><h3>{title}</h3>{description&&<p>{description}</p>}</div><div className="settings-switch-control"><small aria-hidden="true">{value?'On':'Off'}</small><button type="button" role="switch" aria-label={title} aria-checked={value} disabled={disabled} onClick={()=>onChange(!value)} className={`settings-switch ${value?'on':''}`}><span/></button></div></div>;}
export default function Settings(){
 const navigate=useNavigate(),{logout,user}=useAuth();
 const [searchParams, setSearchParams]=useSearchParams();
 const {theme,chooseTheme}=useTheme();
 const section=searchParams.get('section');
 const setSection=value=>setSearchParams(value ? {section:value} : {}, {replace:true});
 const [profile,setProfile]=useState(null),[blocked,setBlocked]=useState([]),[error,setError]=useState(''),[saving,setSaving]=useState(false),[notice,setNotice]=useState('');
 const [device,updateDevice]=useDeviceSettings();
 useEffect(()=>{
   if (notice !== 'Saved on this device') return;
   const timer = setTimeout(()=>setNotice(''), 2200);
   return ()=>clearTimeout(timer);
 },[notice,device]);
 useEffect(()=>{let active=true;Promise.all([api.get('/profile'),api.get('/profile/blocked')]).then(([p,b])=>{if(active){setProfile(p.data);setBlocked(b.data);}}).catch(()=>{if(active)setError('Unable to load settings. Please try again.');});return()=>{active=false;};},[]);
 const privacy=async patch=>{setSaving(true);setError('');try{await api.put('/profile/settings',patch);setProfile(previous=>({...previous,user:{...previous.user,settings:{...previous.user.settings,...patch}}}));setNotice('Saved');}catch(error){setError(error.response?.data?.error||'Unable to save settings.');}finally{setSaving(false);}};
 const unblock=async id=>{setSaving(true);setError('');try{await api.delete('/profile/blocked/'+id);setBlocked(previous=>previous.filter(person=>person.id!==id));setNotice('User unblocked');}catch{setError('Unable to unblock user.');}finally{setSaving(false);}};
 const local=patch=>{try{updateDevice(patch);setNotice('Saved on this device');}catch{setError('Unable to save on this device.');}};
 const saveUsername=async event=>{
   event.preventDefault();
   const username=new FormData(event.currentTarget).get('username');
   if (username?.trim().toLowerCase().replace(/^@/, '') === profile.user.username) return;
   setSaving(true);setError('');setNotice('');
   try {
     const {data}=await api.put('/profile/username',{username});
     setProfile(previous=>({...previous,user:{...previous.user,username:data.username}}));
     setNotice('Username saved');
   } catch (err) { setError(err.response?.data?.error || 'Couldn’t save your username.'); }
   finally {setSaving(false);}
 };
 const saveWorkStatus=async value=>{
   setSaving(true);setError('');setNotice('');
   try {
     const {data}=await api.put('/profile/work-status',{workStatus:value || null});
     setProfile(previous=>({...previous,user:{...previous.user,work_status:data.workStatus}}));
     setNotice('Status saved');
   } catch (err) { setError(err.response?.data?.error || 'Couldn’t save your status.'); }
   finally {setSaving(false);}
 };
 const current=sections.find(item=>item[0]===section),settings=profile?.user?.settings||{};
 const themePicker = <fieldset className="settings-card settings-theme-picker">
   <legend className="sr-only">App theme</legend>
   <h3>App theme</h3>
   <div className="settings-theme-options">
     {['System', 'Light', 'Dark'].map(label=><label key={label}>
       <input type="radio" name="aura-theme" value={label.toLowerCase()} checked={theme===label.toLowerCase()}
         onChange={event=>chooseTheme(event.target.value)}/>
       <span>{label}</span>
     </label>)}
   </div>
   <p className="settings-help">System follows your device appearance.</p>
 </fieldset>;
 return <main className="settings-page"><header className="settings-page-header"><button aria-label="Back" onClick={()=>section?setSection(null):navigate('/profile')}>←</button><h1>{current?.[2]||'Settings'}</h1><span/></header>{error&&<p role="alert" className="settings-error">{error}</p>}{notice&&<p role="status" className="settings-notice">{notice}</p>}
 {!section?<><p className="settings-intro">Make room for what feels like you.</p><div className="settings-categories">{sections.map(([id,icon,title,description,color])=><button key={id} onClick={()=>{setSection(id);setNotice('');}}><span className="settings-category-icon" style={{background:color}}><Icon name={icon} size={21}/></span><div><h2>{title}</h2><p>{description}</p></div><span className="settings-chevron">›</span></button>)}</div>{['admin','staff','superadmin'].includes(user?.user?.management_role)&&<button className="settings-link" onClick={()=>navigate('/admin')}>Management dashboard →</button>}<div className="settings-report-bug"><ReportButton kind="bug" beta/><ReportButton kind="bug"/></div></>:!profile?<p className="p-6 text-sm text-gray-400">Loading settings…</p>:<div className="settings-section-content">
 {section==='redeem'&&<RedeemPremiumCode premiumUntil={profile.user.premium_until} onRedeemed={premium_until=>setProfile(previous=>({...previous,user:{...previous.user,premium_until}}))}/>}
 {section==='account'&&<div className="settings-account">
   <section className="settings-account-identity" aria-label="Your profile">
     <div className="settings-account-person">
       <Avatar src={profile.user.profile_photo} name={profile.user.real_name||profile.aura?.aura_name} gender={profile.user.gender} size={60}/>
       <div>
         <h2>{profile.user.real_name||profile.aura?.aura_name||'Your profile'}</h2>
         {profile.user.real_name&&profile.aura?.aura_name&&profile.user.real_name!==profile.aura.aura_name&&<p>Aura · {profile.aura.aura_name}</p>}
         <p>{profile.user.email}</p>
       </div>
     </div>
     <button className="settings-account-edit" onClick={()=>navigate('/profile?edit=1')}>
       <Icon name="edit" size={17}/> <span>Edit profile</span><Icon name="arrow" size={16}/>
     </button>
   </section>
   <section className="settings-card">
     <form onSubmit={saveUsername} className="space-y-2">
       <label htmlFor="account-username">Public username</label>
       <input id="account-username" key={profile.user.username} name="username" className="aura-input"
         defaultValue={profile.user.username ? '@'+profile.user.username : ''} maxLength={25} required
         autoCapitalize="none" autoComplete="off" spellCheck={false} disabled={saving}/>
       <p className="settings-help">People who can see your Aura can search for this username. Your previous usernames stay reserved to you.</p>
       <button className="aura-btn-secondary" disabled={saving}>Save username</button>
     </form>
   </section>
   <section className="settings-card">
     <label htmlFor="account-work-status">Study or work status</label>
     <select id="account-work-status" className="aura-input mt-2" disabled={saving}
       value={profile.user.work_status || ''} onChange={event=>saveWorkStatus(event.target.value)}>
       <WorkStatusOptions emptyLabel="Not specified"/>
     </select>
     <p className="settings-help">Used for matching in Meet.</p>
   </section>
   <section className="settings-account-session" aria-labelledby="account-session-title">
     <h2 id="account-session-title">Session</h2>
     <LogoutButton className="settings-account-signout" onConfirm={()=>{logout();navigate('/',{replace:true});}}/>
   </section>
   <section className="settings-card"><AccountSessions onSignedOut={()=>{logout();navigate('/login',{replace:true});}}/></section>
   {(!user?.user?.management_role||user.user.management_role==='user')&&<section className="settings-account-delete" aria-labelledby="account-delete-title">
     <h2 id="account-delete-title">Delete your account</h2>
     <p>Permanently removes your profile and content from the live app.</p>
     <DeleteAccountButton onDeleted={()=>{logout();navigate('/',{replace:true});}} onSignInAgain={()=>{logout();navigate('/login',{replace:true});}}/>
   </section>}
 </div>}
 {section==='general'&&<>{themePicker}<h2 className="settings-group-title">Chat appearance</h2><div className="settings-card"><h3>Wallpaper</h3><div className="settings-wallpapers">{['lavender','white','rose'].map(value=><button key={value} aria-label={`${value} chat wallpaper`} aria-pressed={device.wallpaper===value} className={`wallpaper-${value}`} onClick={()=>local({wallpaper:value})}>{value}</button>)}</div><Toggle title="Larger message text" value={device.largeText} onChange={value=>local({largeText:value})}/></div><h2 className="settings-group-title">Keyboard</h2><div className="settings-card"><Toggle title="Enter to send" description="Use Enter to send text in connection chats." value={device.enterToSend} onChange={value=>local({enterToSend:value})}/></div><p className="settings-help">Appearance and keyboard preferences apply on this device.</p></>}
 {section==='notifications'&&<><NotificationSettings sound={device.messageSound} onSoundChange={messageSound=>local({messageSound})}/><div className="settings-card"><Toggle title="Unread badges" description="Show unread message counts in Connections." value={device.badges} onChange={value=>local({badges:value})}/></div></>}
 {section==='privacy'&&<><div className="settings-card"><Toggle title="Show active status" description="Let your connections see when you are online." value={!settings.hide_online} disabled={saving} onChange={value=>privacy({hide_online:!value})}/><Toggle title="Show last active" description="Share when you were last online." value={!settings.hide_last_active} disabled={saving} onChange={value=>privacy({hide_last_active:!value})}/><Toggle title="Private dating mode · Premium" description="Active Premium is required to turn on. Only people you send an Aura to and existing connections can discover you." value={!!settings.private_dating} disabled={saving||(!settings.private_dating&&!(Date.parse(profile.user.premium_until)>Date.now()))} onChange={value=>privacy({private_dating:value})}/></div><h2 className="settings-group-title">Blocked users · {blocked.length}</h2><div className="settings-card">{blocked.length?blocked.map(person=><div className="settings-blocked" key={person.id}><Avatar name={person.aura_name} size={35}/><span>{person.aura_name||'Aura'}</span><button disabled={saving} onClick={()=>unblock(person.id)}>Unblock</button></div>):<p className="settings-help">You have no blocked users.</p>}</div></>}
 {section==='data'&&<><div className="settings-card"><Toggle title="Automatically load chat media" description="Turn off to load photos and voice messages only when you tap them." value={device.autoMedia} onChange={value=>local({autoMedia:value})}/></div><h2 className="settings-group-title">Storage</h2><div className="settings-card"><h3>Media stays in your conversations</h3><p className="settings-help">Media previews are temporary. AURA does not keep an offline media library on this device.</p></div></>}
 </div>}</main>;
}

