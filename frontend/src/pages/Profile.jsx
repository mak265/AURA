import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import ProfilePhotoEditor from '../components/ProfilePhotoEditor';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import BottomNav from '../components/BottomNav';
import ProfilePosts from '../components/ProfilePosts';
import { ConnectionFields, ConnectionDetails } from '../components/ConnectionProfile';

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
  const [vibe, setVibe] = useState('');
  const [intention, setIntention] = useState('');
  const [answers, setAnswers] = useState(['','','']);
  const applyProfile = useCallback(data => {
    setProfile({ ...data.aura, ...data.user, interests: data.interests, stats: data.stats });
    setBio(data.aura?.bio || '');
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
    setBio(profile.bio || ''); setVibe(profile.vibe || '');
    setIntention(profile.dating_intention || '');
    setAnswers(profile.prompt_answers?.length === 3 ? profile.prompt_answers : ['','','']);
    setError(''); setEditMode(true); setTab('about');
  };
  const saveProfile = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await api.put('/aura', { aura_name: profile.aura_name, aura_color: profile.aura_color, emoji: profile.emoji, bio, vibe, dating_intention: intention, prompt_answers: answers });
      const [response] = await Promise.all([api.get('/profile'),refreshUser()]);
      applyProfile(response.data);
      setEditMode(false);
    } catch (err) { setError(err.response?.data?.error || 'Unable to save your profile.'); }
    finally { setSaving(false); }
  };
  useEffect(()=>{if(profile&&new URLSearchParams(window.location.search).get('edit')==='1'){editProfile();navigate('/profile',{replace:true});}},[!!profile]);
  const name = profile?.real_name || profile?.aura_name || 'Your profile';
  if (!profile) return <main className="min-h-screen bg-aura-deep p-6"><p className="text-sm text-gray-400" role={error?'alert':undefined}>{error || 'Loading profile…'}</p><BottomNav/></main>;
  return <main className="min-h-screen bg-aura-deep pb-28">
    <header className="profile-page-bar"><span>{name}</span><button aria-label="Settings" onClick={()=>navigate('/settings')}><Icon name="filters" size={21}/></button></header>
    <div className="social-profile-cover" style={{'--identity-color':profile.aura_color}}><div className="identity-orbit"/></div>
    <section className="social-profile-intro">
      <Avatar src={profile.profile_photo} name={name} size={92} className="social-profile-avatar"/><ProfilePhotoEditor photo={profile.profile_photo} onSaved={async photo=>{setProfile(previous=>({...previous,profile_photo:photo}));await refreshUser();}}/>
      <h1>{name}</h1><p className="text-xs text-aura-violet-light mt-1">{profile.aura_name}</p>
      <p className="text-sm text-gray-300 mt-4 whitespace-pre-wrap leading-relaxed">{profile.bio || 'Tell your story. Add a little about yourself.'}</p>
      <p className="text-xs text-gray-400 mt-3">{[profile.age,profile.gender,profile.city].filter(Boolean).join(' · ')}</p>
      <div className="flex gap-5 text-xs text-gray-400 mt-4"><span><strong className="text-white font-medium">{posts.length}</strong> {posts.length === 1 ? 'post' : 'posts'}</span><span><strong className="text-white font-medium">{profile.stats?.matches || 0}</strong> {profile.stats?.matches === 1 ? 'connection' : 'connections'}</span></div>
      <button className="aura-btn-secondary mt-5 !py-3 text-sm" onClick={editProfile}>Edit profile</button>
      <p className="text-[10px] text-gray-400 mt-3">Others see your aura name until you both reveal your identities.</p>
    </section>
    <section className="mx-5 mb-5 aura-card p-4">
      <div className="flex items-center justify-between gap-4"><div><h2 className="text-sm font-medium">Private dating mode</h2><p className="text-[10px] text-aura-violet-light mt-1">{profile.settings?.private_dating?'On · Your visibility is limited':'Off · Your aura can be discovered'}</p></div><button type="button" role="switch" aria-checked={!!profile.settings?.private_dating} aria-label="Private dating mode" disabled={privacySaving} onClick={togglePrivateDating} className={`w-12 h-7 rounded-full p-1 transition-colors shrink-0 ${profile.settings?.private_dating?'bg-aura-violet':'bg-aura-elevated border border-aura-border'}`}><span className={`block w-5 h-5 rounded-full bg-white transition-transform ${profile.settings?.private_dating?'translate-x-5':'translate-x-0'}`}/></button></div>
      <p className="text-xs text-gray-400 leading-relaxed mt-3">Only people you send an Aura to and your existing connections can discover your profile and posts. Each post's audience still applies. Soul Talk also respects these visibility limits.</p>
      {privacyError&&<p role="alert" className="text-xs text-red-400 mt-2">{privacyError}</p>}
    </section>
    <nav aria-label="Profile sections" className="profile-tabs">{['posts','about'].map(value=><button key={value} aria-pressed={tab===value} className={tab===value?'active':''} onClick={()=>setTab(value)}>{value==='posts'?'Posts':'About'}</button>)}</nav>
    <div className="px-5 pt-5">
      {tab==='posts' ? <ProfilePosts own posts={posts} name={name} photo={profile.profile_photo} loading={postsLoading} error={postsError} onCreated={post=>setPosts(previous=>[post,...previous])}/> : <div className="space-y-4">
        <section className="aura-card p-5">
          <h2 className="font-medium mb-4">About {name}</h2>
          {editMode ? <form onSubmit={saveProfile} className="space-y-4">
            <label className="block text-xs text-gray-400">Aura name<input required maxLength={80} className="aura-input mt-2" value={profile.aura_name||''} onChange={event=>setProfile(previous=>({...previous,aura_name:event.target.value}))}/></label>
            <label className="block text-xs text-gray-400">Vibe<input className="aura-input mt-2" value={vibe} onChange={event=>setVibe(event.target.value)}/></label>
            <label className="block text-xs text-gray-400">Bio<textarea rows={3} className="aura-input mt-2 resize-none" value={bio} onChange={event=>setBio(event.target.value)}/></label>
            <ConnectionFields intention={intention} setIntention={setIntention} answers={answers} setAnswers={setAnswers}/>
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-3"><button type="button" className="aura-btn-secondary !py-3" disabled={saving} onClick={()=>{setEditMode(false);setError('');}}>Cancel</button><button className="aura-btn-primary !py-3" disabled={saving}>{saving?'Saving…':'Save changes'}</button></div>
          </form> : <>
            <dl className="profile-details">{[['Lives in',profile.city],['Age',profile.age],['Gender',profile.gender],['Religion',profile.religion],['Vibe',profile.vibe]].filter(([,value])=>value).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            <ConnectionDetails intention={profile.dating_intention} answers={profile.prompt_answers}/>
            <div className="flex flex-wrap gap-2 mt-4">{profile.interests?.map(interest=><span key={interest.name} className="text-xs bg-aura-elevated rounded-full px-3 py-1">{interest.name}</span>)}</div>
          </>}
        </section>
        <section className="aura-card p-5"><div className="flex justify-between items-center gap-4"><div><h2 className="text-sm font-medium">Show active status</h2><p className="text-xs text-gray-400 mt-2">Let your connections see when you are active and when you were last online.</p></div><button role="switch" aria-label="Show active status" aria-checked={!profile.settings?.hide_online} disabled={privacySaving} onClick={toggleActiveStatus} className={`w-12 h-7 rounded-full p-1 shrink-0 ${profile.settings?.hide_online?'bg-aura-elevated':'bg-aura-violet'}`}><span className={`block w-5 h-5 rounded-full bg-white ${profile.settings?.hide_online?'':'translate-x-5'}`}/></button></div>{privacyError&&<p role="alert" className="text-xs text-red-400 mt-3">{privacyError}</p>}</section>
        <details className="aura-card p-5"><summary className="text-sm cursor-pointer">Account · Only you</summary><p className="text-xs text-gray-400 mt-4 break-all">{profile.email}</p><button onClick={()=>{logout();navigate('/');}} className="text-sm text-red-400 mt-4 py-2">Log out</button></details>
      </div>}
    </div>
    <BottomNav/>
  </main>;
}
