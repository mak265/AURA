import { useEffect, useState } from 'react';
import api from '../api/client';
import Avatar from './Avatar';

export default function ProfileViewers({ count }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    const controller = new AbortController();
    api.get('/profile/views', { signal: controller.signal })
      .then(({ data }) => setState({ viewers: data.viewers }))
      .catch(error => {
        if (controller.signal.aborted) return;
        setState(error.response?.data?.code === 'PREMIUM_REQUIRED'
          ? { locked: true }
          : { error: 'Unable to load viewers. Reopen this tab to try again.' });
      });
    return () => controller.abort();
  }, []);

  return <section className="you-card space-y-3">
    <div className="flex items-center justify-between gap-2">
      <h2 className="font-semibold">Who viewed you</h2>
      <span className="rounded-full bg-aura-elevated px-3 py-1 text-xs text-aura-violet-light">Premium</span>
    </div>
    <p className="text-sm text-gray-400">{count} {count === 1 ? 'person has' : 'people have'} viewed your profile.</p>
    {state.loading && <p className="you-empty" role="status">Loading profile viewers…</p>}
    {state.locked && <p className="you-empty">Unlock with AURA Premium to see who recently opened your profile.</p>}
    {state.error && <p className="you-empty" role="alert">{state.error}</p>}
    {state.viewers?.length === 0 && <p className="you-empty">No profile views yet. Visits will appear here as people open your Aura or connection profile.</p>}
    {state.viewers?.length > 0 && <ul className="divide-y divide-aura-border">
      {state.viewers.map(viewer => <li key={viewer.id} className="flex items-center gap-3 py-3">
        <Avatar name={viewer.aura_name} size={36}/>
        <div>
          <p className="text-sm font-medium">{viewer.aura_name}</p>
          <time className="text-xs text-gray-400" dateTime={viewer.viewed_at}>{new Date(viewer.viewed_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time>
        </div>
      </li>)}
    </ul>}
  </section>;
}
