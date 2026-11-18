import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import Avatar from './Avatar';
import PostAudience from './PostAudience';

export default function PostIdentity({ value, onChange, audience, profile, caption, image, disabled }) {
  const [loadedProfile, setLoadedProfile] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (profile) return;
    const request = new AbortController();
    api.get('/aura/me', { signal: request.signal, timeout: 5000 })
      .then(({ data }) => setLoadedProfile({
        auraName: data.aura?.aura_name, realName: data.user?.real_name, photo: data.user?.profile_photo,
      }))
      .catch(() => { if (!request.signal.aborted) setUnavailable(true); });
    return () => request.abort();
  }, [profile]);

  const identity = profile || loadedProfile;
  const realName = identity?.realName?.trim();
  const real = value === 'profile' && Boolean(realName);
  const name = (real ? realName : identity?.auraName) || 'Your Aura';

  return <div className="space-y-2">
    <label className="flex items-center gap-2 text-xs font-medium">
      Post as
      <select className="rounded-lg border border-aura-border bg-aura-elevated px-2 py-2 text-sm"
        value={value} onChange={event => onChange(event.target.value)} disabled={disabled}>
        <option value="aura">Aura identity</option>
        <option value="profile" disabled={!realName}>Real profile</option>
      </select>
    </label>
    <details className="journal-preview">
      <summary className="text-xs font-medium">Preview post <span className="text-gray-400 font-normal">· {name}</span></summary>
      <div className="journal-preview-card">
        <div className="flex items-center gap-2">
          <Avatar src={real ? identity.photo : null} name={name} size={34}/>
          <div className="min-w-0"><strong className="block text-sm break-words">{name}</strong><PostAudience value={audience}/></div>
        </div>
        {caption?.trim() && <p className="text-sm whitespace-pre-wrap break-words">{caption}</p>}
        {image && <img src={image} alt="Attached photo preview" className="w-full max-h-56 object-contain rounded-lg"/>}
      </div>
    </details>
    {real && audience !== 'private' && <p className="text-xs text-aura-violet-light">This audience can see your real name and profile photo.</p>}
    {identity && !realName && <Link to="/profile?edit=1" className="inline-block text-xs text-aura-violet-light underline">Add your real name to use your real profile</Link>}
    {unavailable && <p className="text-xs text-gray-400">Real profile is unavailable. You can still post as your Aura.</p>}
  </div>;
}
