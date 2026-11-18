import LogoutButton from '../components/LogoutButton';
import Icon from '../components/Icon';
import AppTopBar from '../components/AppTopBar';
import './profile.css';
import Avatar from '../components/Avatar';
import ProfilePhotoEditor from '../components/ProfilePhotoEditor';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import ProfilePosts from '../components/ProfilePosts';
import SavedPosts from '../components/SavedPosts';
import ProfileViewers from '../components/ProfileViewers';
import { ConnectionFields, ConnectionDetails } from '../components/ConnectionProfile';

const PROFILE_RELIGIONS = ['Iglesia ni Cristo', 'Catholic', 'Born Again / Evangelical', 'Christian', 'Seventh-day Adventist', "Jehovah’s Witnesses", 'Mormon / Latter Day Saints', 'Pentecostal', 'Baptist', 'Methodist', 'Protestant', 'Muslim', 'Buddhist', 'Hindu', 'Jewish', 'Sikh', 'Taoist', "Baha’i", 'Agnostic', 'Atheist', 'Spiritual', 'Other', 'Prefer not to say'].map(value => value.replaceAll('’', "'"));

export default function Profile() {
  const { logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('posts');
  const [editMode, setEditMode] = useState(false);
  const [privacySaving,setPrivacySaving]=useState(false);
  const [privacyError,setPrivacyError]=useState('');
  const [saving, setSaving] = useState(false);
  const [bio, setBio] = useState('');
  const [auraName,setAuraName]=useState('');
  const [vibe, setVibe] = useState('');
  const [intention, setIntention] = useState('');
  const [answers, setAnswers] = useState(['','','']);
  const [basics, setBasics] = useState({});
  const [availableInterests, setAvailableInterests] = useState(null);
  const [selectedInterests, setSelectedInterests] = useState([]);
  const applyProfile = useCallback(data => {
    setProfile({ ...data.aura, ...data.user, interests: data.interests, stats: data.stats });
    setBio(data.aura?.bio || '');
    setAuraName(data.aura?.aura_name || '');
    setVibe(data.aura?.vibe || '');
    setIntention(data.aura?.dating_intention || '');
    setAnswers(data.aura?.prompt_answers?.length === 3 ? data.aura.prompt_answers : ['','','']);
  }, []);
  useEffect(() => {
    let active = true;
    api.get('/profile').then(response => { if (active) applyProfile(response.data); })
      .catch(() => { if (active) setError('Unable to load your profile. Please refresh.'); });
    api.get('/profile/posts').then(response => { if (active) setPosts(response.data); })
      .catch(() => { if (active) setPostsError('Unable to load your posts. Please refresh.'); })
      .finally(() => { if (active) setPostsLoading(false); });
    return () => { active = false; };
  }, [applyProfile]);
  const togglePrivateDating = async () => {
    const value = !profile.settings?.private_dating;
    setPrivacySaving(true);setPrivacyError('');
    try {
      await api.put('/profile/settings',{private_dating:value});
      setProfile(previous=>({...previous,settings:{...previous.settings,private_dating:value}}));
    } catch(err) {setPrivacyError(err.response?.data?.error || 'Unable to update private dating mode.');}
    finally {setPrivacySaving(false);}
  };
  const toggleActiveStatus = async () => {
    const hide=!profile.settings?.hide_online;
    setPrivacySaving(true);setPrivacyError('');
    try{
      await api.put('/profile/settings',{hide_online:hide,hide_last_active:hide});
      setProfile(previous=>({...previous,settings:{...previous.settings,hide_online:hide,hide_last_active:hide}}));
    }catch(err){setPrivacyError(err.response?.data?.error||'Unable to update active status.');}
    finally{setPrivacySaving(false);}
  };
  const editProfile = () => {
    setAuraName(profile.aura_name || '');
    setBio(profile.bio || ''); setVibe(profile.vibe || '');
    setIntention(profile.dating_intention || '');
    setAnswers(profile.prompt_answers?.length === 3 ? profile.prompt_answers : ['','','']);
    setBasics({ real_name: profile.real_name ?? '', age: profile.age ?? '', city: profile.city ?? '', gender: profile.gender ?? '', religion: profile.religion ?? '' });
    setSelectedInterests(profile.interests?.map(interest => interest.id) || []);
    setError(''); setEditMode(true); setTab('about');
  };
  useEffect(() => {
    if (!editMode || availableInterests) return;
    const controller = new AbortController();
    api.get('/aura/interests', { signal: controller.signal }).then(({ data }) => setAvailableInterests(data)).catch(() => {});
    return () => controller.abort();
  }, [editMode, availableInterests]);
  const saveProfile = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await api.put('/profile', {
        aura_name: auraName, aura_color: profile.aura_color, emoji: profile.emoji, bio, vibe,
        dating_intention: intention, prompt_answers: answers,
        ...basics, age: basics.age ? Number(basics.age) : null,
        ...(availableInterests ? { interests: selectedInterests } : {}),
      });
      const [response] = await Promise.all([api.get('/profile'),refreshUser()]);
      applyProfile(response.data);
      setEditMode(false);
    } catch (err) { setError(err.response?.data?.error || 'Unable to save your profile.'); }
    finally { setSaving(false); }
  };
  useEffect(()=>{if(profile&&new URLSearchParams(window.location.search).get('edit')==='1'){editProfile();navigate('/profile',{replace:true});}},[!!profile]);
  const canEnablePrivateDating = Date.parse(profile?.premium_until) > Date.now();
  const name = profile?.real_name || profile?.aura_name || 'Your profile';
  if (!profile) return <main className="min-h-screen bg-aura-deep p-6"><p className="text-sm text-gray-400" role={error?'alert':undefined}>{error || 'Loading profile…'}</p></main>;
  return <main className="mobile-tab-screen you-page min-h-screen bg-aura-deep pb-28">
    <AppTopBar title="You"><button className="mobile-icon-action" aria-label="Settings" onClick={()=>navigate('/settings')}><Icon name="filters" size={20}/></button></AppTopBar>
    <div className="social-profile-cover you-cover" style={{'--identity-color':profile.aura_color}}><span className="you-cover-mark">aura.</span><div className="identity-orbit"/></div>
    <section className="social-profile-intro you-intro" aria-label="Your profile overview">
      <Avatar src={profile.profile_photo} name={name} gender={profile.gender} size={92} className="social-profile-avatar"/>
      <div className="you-identity"><h1>{name}</h1>
        {profile.username && <button className="text-sm text-aura-violet-light mt-1" onClick={()=>navigate('/settings?section=account')}>@{profile.username}</button>}
        <p className="you-aura-name">{profile.aura_name&&profile.aura_name!==name?'Aura · '+profile.aura_name:'Your public aura'}<span className="you-identity-hint"><Icon name="lock" size={11}/>Identity shared after mutual reveal</span></p></div>
      {profile.bio?<p className="you-bio">{profile.bio}</p>:<button className="you-add-bio" onClick={editProfile}>Add a bio to introduce yourself →</button>}
      <div className="you-summary">{profile.city&&<span><Icon name="globe" size={13}/>{profile.city}</span>}{profile.age&&<span>{profile.age} years old</span>}{profile.vibe&&<span className="you-vibe">{profile.vibe}</span>}</div>
      <div className="you-actions"><button className="aura-btn-primary" onClick={editProfile}><Icon name="edit" size={15}/>Edit profile</button><details className="you-photo-options"><summary><Icon name="photo" size={15}/>Photo options</summary><div className="you-photo-panel"><ProfilePhotoEditor photo={profile.profile_photo} onSaved={async photo=>{setProfile(previous=>({...previous,profile_photo:photo}));await refreshUser();}}/></div></details></div>
      <div className="you-stats"><button onClick={()=>{setTab('posts');setEditMode(false);}}><strong>{postsLoading?'—':posts.length}</strong><span>{posts.length===1?'Post':'Posts'}</span></button><button onClick={()=>navigate('/matches')}><strong>{profile.stats?.matches||0}</strong><span>{profile.stats?.matches===1?'Connection':'Connections'}</span></button></div>
      <button className="you-visibility" onClick={()=>{setTab('privacy');setEditMode(false);}}><span className="you-visibility-icon"><Icon name={profile.settings?.private_dating?'lock':'globe'} size={16}/></span><span><strong>{profile.settings?.private_dating?'Private dating is on':'Your aura is discoverable'}</strong><small>Manage who can find you</small></span><Icon name="arrow" size={16}/></button>
    </section>
    <nav aria-label="Profile sections" className="profile-tabs you-tabs">{[['posts','Posts'],['saved','Saved'],['about','About'],['privacy','Privacy'],['views','Viewers']].map(([value,label])=><button key={value} aria-pressed={tab===value} className={tab===value?'active':''} onClick={()=>{setTab(value);if(value!=='about')setEditMode(false);}}>{label}{value==='views' && <span className="ml-1 rounded-full bg-aura-elevated px-1.5 py-0.5 text-[10px] text-aura-violet-light">{profile.stats?.profileViewers ?? 0}</span>}</button>)}</nav>
    <div className="you-content">
      {tab==='posts'?<><div className="you-section-heading"><div><h2>Your journal</h2><p>Moments you’ve shared, in one place.</p></div></div><ProfilePosts own posts={posts} identityProfile={{ auraName: profile.aura_name, realName: profile.real_name, photo: profile.profile_photo }} loading={postsLoading} error={postsError} onCreated={post => setPosts(previous => [post, ...previous])}
        onUpdated={(id, changes) => setPosts(previous => previous.map(post => post.id === id ? { ...post, ...changes } : post))}
        onDeleted={id => setPosts(previous => previous.filter(post => post.id !== id))}/></>:tab==='saved'?<SavedPosts onUnsave={id => setPosts(previous => previous.map(post => post.id === id ? { ...post, saved_by_me: false } : post))}/>:tab==='about'?<>
        <div className="you-section-heading"><div><h2>{editMode?'Edit your profile':'A little more about you'}</h2><p>{editMode?'Make your introduction feel like you.':'The details behind your aura.'}</p></div>{!editMode&&<button onClick={editProfile}>Edit</button>}</div>
        {editMode?<section className="you-card you-edit-card"><form onSubmit={saveProfile} className="space-y-4">
            <label className="block text-xs text-gray-400">Aura name<input required maxLength={80} className="aura-input mt-2" value={auraName} onChange={event=>setAuraName(event.target.value)}/></label>
            <label className="block text-xs text-gray-400">Vibe<input className="aura-input mt-2" value={vibe} onChange={event=>setVibe(event.target.value)}/></label>
            <label className="block text-xs text-gray-400">Bio<textarea rows={3} className="aura-input mt-2 resize-none" value={bio} onChange={event=>setBio(event.target.value)}/></label>
            <fieldset className="space-y-3">
              <legend className="font-semibold text-sm mb-2">About you <span className="text-xs text-gray-400">· Optional</span></legend>
              {Object.entries({ real_name: 'Name shared after mutual reveal', age: 'Age', city: 'City' }).map(([field, label]) =>
                <label key={field} className="block text-xs text-gray-400">{label}<input className="aura-input mt-2" type={field === 'age' ? 'number' : 'text'} min={field === 'age' ? 18 : undefined} max={field === 'age' ? 120 : undefined} maxLength={80} value={basics[field]} onChange={event => setBasics(current => ({ ...current, [field]: event.target.value }))}/></label>)}
              {Object.entries({ gender: ['Female', 'Male', 'Nonbinary'], religion: PROFILE_RELIGIONS }).map(([field, options]) =>
                <label key={field} className="block text-xs text-gray-400 capitalize">{field}<select className="aura-input mt-2" value={basics[field]} onChange={event => setBasics(current => ({ ...current, [field]: event.target.value }))}>
                  <option value="">Not specified</option>
                  {[...new Set([...options, basics[field]].filter(Boolean))].map(value => <option key={value} value={value}>{value}</option>)}
                </select></label>)}
            </fieldset>
            {availableInterests && <fieldset className="flex flex-wrap gap-2"><legend className="font-semibold text-sm mb-2">Interests</legend>
              {availableInterests.map(interest => <label className="flex items-center gap-2 min-h-11 px-2 text-sm" key={interest.id}>
                <input type="checkbox" checked={selectedInterests.includes(interest.id)} onChange={event => {
                  const checked = event.target.checked;
                  setSelectedInterests(current => checked ? [...current, interest.id] : current.filter(id => id !== interest.id));
                }}/>{interest.name}
              </label>)}
            </fieldset>}
            <ConnectionFields intention={intention} setIntention={setIntention} answers={answers} setAnswers={setAnswers}/>
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-3"><button type="button" className="aura-btn-secondary !py-3" disabled={saving} onClick={()=>{setEditMode(false);setError('');}}>Cancel</button><button className="aura-btn-primary !py-3" disabled={saving}>{saving?'Saving…':'Save changes'}</button></div>
          </form></section>:<>
          <section className="you-card"><div className="you-card-heading"><Icon name="profile" size={17}/><h3>The basics</h3></div><dl className="you-detail-grid">{[['Age',profile.age?profile.age+' years old':null],['Gender',profile.gender],['Lives in',profile.city],['Religion',profile.religion]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Not added yet'}</dd></div>)}</dl></section>
          <section className="you-card"><div className="you-card-heading"><Icon name="heart" size={17}/><h3>Dating & personality</h3></div>{profile.dating_intention||profile.prompt_answers?.some(Boolean)?<ConnectionDetails intention={profile.dating_intention} answers={profile.prompt_answers||[]}/>:<p className="you-empty">Add your dating intention and a few answers to help people get to know you.</p>}</section>
          <section className="you-card"><div className="you-card-heading"><Icon name="spark" size={17}/><h3>Your interests</h3></div>{profile.interests?.length?<div className="you-interests">{profile.interests.map(interest=><span key={interest.name}>{interest.name}</span>)}</div>:<p className="you-empty">No interests added yet.</p>}</section>
        </>}
      </>:tab==='views'?<ProfileViewers count={profile.stats?.profileViewers ?? 0}/>:<>
        <div className="you-section-heading"><div><h2>Your visibility & account</h2><p>These controls are only visible to you.</p></div></div>
        <p className="you-empty">When you open someone’s Aura or connection profile, they can see your Aura name and visit time with Premium.</p>
        <section className="you-card you-privacy-card">
      <div className="flex items-center justify-between gap-4"><div><h2 className="text-sm font-medium">Private dating mode <span className="text-[10px] text-aura-violet-light">· Premium</span></h2><p className="text-[10px] text-aura-violet-light mt-1">{profile.settings?.private_dating?'On · Your visibility is limited':canEnablePrivateDating?'Off · Your aura can be discovered':'Premium required to turn on'}</p></div><button type="button" role="switch" aria-checked={!!profile.settings?.private_dating} aria-label="Private dating mode" disabled={privacySaving||(!canEnablePrivateDating&&!profile.settings?.private_dating)} onClick={togglePrivateDating} className={`w-12 h-7 rounded-full p-1 transition-colors shrink-0 ${profile.settings?.private_dating?'bg-aura-violet':'bg-aura-elevated border border-aura-border'}`}><span className={`block w-5 h-5 rounded-full bg-white transition-transform ${profile.settings?.private_dating?'translate-x-5':'translate-x-0'}`}/></button></div>
      <p className="text-xs text-gray-400 leading-relaxed mt-3">Only people you send an Aura to and your existing connections can discover your profile and posts. Each post's audience still applies. Meet also respects these visibility limits.</p>
      {privacyError&&<p role="alert" className="text-xs text-red-400 mt-2">{privacyError}</p>}
    </section>
        <section className="you-card you-privacy-card"><div className="flex justify-between items-center gap-4"><div><h2 className="text-sm font-medium">Show active status</h2><p className="text-xs text-gray-400 mt-2">Let your connections see when you are active and when you were last online.</p></div><button role="switch" aria-label="Show active status" aria-checked={!profile.settings?.hide_online} disabled={privacySaving} onClick={toggleActiveStatus} className={`w-12 h-7 rounded-full p-1 shrink-0 ${profile.settings?.hide_online?'bg-aura-elevated':'bg-aura-violet'}`}><span className={`block w-5 h-5 rounded-full bg-white ${profile.settings?.hide_online?'':'translate-x-5'}`}/></button></div>{privacyError&&<p role="alert" className="text-xs text-red-400 mt-3">{privacyError}</p>}</section>
        <details className="you-card you-account"><summary className="text-sm cursor-pointer">Account · Only you</summary><p className="text-xs text-gray-400 mt-4 break-all">{profile.email}</p><LogoutButton onConfirm={()=>{logout();navigate('/',{replace:true});}} className="text-sm text-red-400 mt-4 py-2"/></details>
      </>}
    </div>
  </main>;
}
