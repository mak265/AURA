import { useEffect, useState } from 'react';
import api from '../api/client';
import LogoutButton from './LogoutButton';

export default function AccountSessions({ onSignedOut }) {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api.get('/auth/sessions', { signal: controller.signal, timeout: 10000 })
      .then(({ data }) => { if (!controller.signal.aborted) setSessions(data); })
      .catch(() => { if (!controller.signal.aborted) setError('Couldn’t load your devices.'); });
    return () => controller.abort();
  }, [attempt]);

  return <div className="space-y-3">
    <h3 className="text-sm font-semibold">Active devices</h3>
    {sessions ? <ul className="space-y-2">
      {sessions.map((session, index) => <li key={index} className="bg-aura-elevated rounded-xl p-3 text-sm">
        <strong>{session.device_label}</strong>{session.current && <span className="ml-2 text-xs text-aura-violet-light">This session</span>}
        {session.created_at && <p className="text-xs text-gray-500 mt-1">Signed in {new Date(session.created_at).toLocaleString()}</p>}
      </li>)}
    </ul> : error ? <p role="alert" className="text-sm">{error}{' '}
      <button className="text-aura-violet-light underline" onClick={()=>{setError('');setAttempt(value=>value+1);}}>Try again</button>
    </p> : <p role="status" className="text-sm text-gray-500">Loading devices…</p>}
    <LogoutButton allDevices className="settings-account-signout" onConfirm={async()=>{
      await api.delete('/auth/sessions', {timeout:10000});
      onSignedOut();
    }}>Log out of all devices</LogoutButton>
  </div>;
}
