import Avatar from '../components/Avatar';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import BottomNav from '../components/BottomNav';
import ProfilePosts from '../components/ProfilePosts';
import { ConnectionDetails } from '../components/ConnectionProfile';

export default function ConnectionProfile() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('posts');
  useEffect(() => {
    let active = true;
    api.get(`/matches/${matchId}/profile`).then(response => { if (active) setProfile(response.data); })
      .catch(err => { if (active) setError(err.response?.data?.error || 'Unable to load profile.'); });
    window.scrollTo(0,0);
    return () => { active = false; };
  }, [matchId]);
  const name = profile?.real_name || profile?.aura_name;
  return <main className="min-h-screen bg-aura-deep pb-28">
    <header className="profile-page-bar"><button onClick={() => navigate(`/chat/${matchId}`)} aria-label="Back to conversation" className="text-aura-violet-light px-2 py-2">←</button><span>{name || 'Profile'}</span></header>
    {error ? <p role="alert" className="p-6 text-sm text-red-400">{error}</p> : !profile ? <p className="p-6 text-gray-400 text-sm">Loading profile…</p> : <>
      <div className="social-profile-cover" style={{'--identity-color':profile.aura_color}}><div className="identity-orbit"/></div>
      <section className="social-profile-intro"><Avatar src={profile.profile_photo} name={name} size={92} className="social-profile-avatar"/><h1>{name}</h1><p className="text-xs text-aura-violet-light mt-1">{profile.aura_name} · Identity revealed</p><p className="text-sm text-gray-300 mt-4 leading-relaxed whitespace-pre-wrap">{profile.bio || 'A little mystery remains.'}</p><p className="text-xs text-gray-400 mt-3">{[profile.age,profile.gender,profile.city].filter(Boolean).join(' · ')}</p><button className="aura-btn-primary mt-5 !py-3 text-sm" onClick={() => navigate(`/chat/${matchId}`)}>Message {name}</button></section>
      <nav aria-label="Profile sections" className="profile-tabs">{['posts','about'].map(value => <button key={value} aria-pressed={tab===value} onClick={() => setTab(value)} className={tab===value?'active':''}>{value === 'posts' ? 'Posts' : 'About'}</button>)}</nav>
      <div className="px-5 pt-5">{tab==='posts' ? <ProfilePosts posts={profile.posts} name={name} photo={profile.profile_photo}/> : <section className="aura-card p-5 space-y-4"><h2 className="font-medium">About {name}</h2><dl className="profile-details">{[['Lives in',profile.city],['Age',profile.age],['Gender',profile.gender],['Religion',profile.religion],['Vibe',profile.vibe]].filter(([,value])=>value).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><ConnectionDetails intention={profile.dating_intention} answers={profile.prompt_answers}/><div className="flex flex-wrap gap-2">{profile.interests.map(interest=><span key={interest.name} className="text-xs bg-aura-elevated px-3 py-1 rounded-full">{interest.name}</span>)}</div></section>}</div>
    </>}
    <BottomNav/>
  </main>;
}
