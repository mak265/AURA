import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import Icon from './Icon';

const endpoint = '/meet-sessions';
const dateTime = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', timeZoneName: 'short'
});

export default function ScheduledMeetSessions({ visible, onJoin, canJoin }) {
  const [searchParams] = useSearchParams();
  const requestedId = searchParams.get('session');
  const [sessions, setSessions] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [reminderError, setReminderError] = useState('');
  const [saving, setSaving] = useState(false);
  const mutation = useRef(false);
  const request = useRef(null);
  const target = useRef(null);
  const lastScrolled = useRef(null);

  useEffect(() => {
    if (!visible) {
      lastScrolled.current = null;
      return;
    }
    const loadSessions = async () => {
      if (mutation.current) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      try {
        const { data } = await api.get(endpoint, {
          params: { session: requestedId }, signal: controller.signal, timeout: 8000
        });
        if (controller.signal.aborted) return;
        setSessions(data.sessions);
        setLoadError(false);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      }
    };
    loadSessions();
    window.addEventListener('focus', loadSessions);
    window.addEventListener('aura:meet-reminder', loadSessions);
    const timer = setInterval(loadSessions, 15000);
    return () => {
      request.current?.abort();
      window.removeEventListener('focus', loadSessions);
      window.removeEventListener('aura:meet-reminder', loadSessions);
      clearInterval(timer);
    };
  }, [visible, requestedId]);

  useEffect(() => {
    if (!requestedId) lastScrolled.current = null;
    if (!visible || !target.current || !requestedId || lastScrolled.current === requestedId) return;
    target.current.scrollIntoView({ block: 'nearest' });
    lastScrolled.current = requestedId;
  }, [visible, requestedId, sessions]);

  async function toggleReminder(session) {
    if (mutation.current) return;
    mutation.current = true;
    request.current?.abort();
    setSaving(true);
    setReminderError('');
    try {
      const path = `${endpoint}/${session.id}/reminder`;
      if (session.reminded) await api.delete(path, { timeout: 8000 });
      else await api.put(path, undefined, { timeout: 8000 });
      setSessions(items => items.map(item => item.id === session.id ? { ...item, reminded: !session.reminded } : item));
    } catch (error) {
      setReminderError(error.response?.data?.error || 'Couldn’t update your reminder. Try again.');
    } finally {
      mutation.current = false;
      setSaving(false);
    }
  }

  const requestedSessionExists = sessions?.some(session => String(session.id) === requestedId);
  if (!requestedId && !sessions?.length && !reminderError) return null;

  return <section className="meet-scheduled" aria-labelledby="meet-scheduled-heading">
    <div className="meet-section-heading"><h2 id="meet-scheduled-heading">Meet sessions</h2></div>
    {loadError && <p className="meet-lounges-status" role="status">Couldn’t load scheduled sessions. Retrying…</p>}
    {reminderError && <p className="meet-status" role="alert">{reminderError}</p>}
    {requestedId && sessions && !loadError && !requestedSessionExists &&
      <p className="meet-lounges-status" role="status">This Meet session has ended or was cancelled.</p>}
    {!loadError && !sessions && <p className="meet-lounges-status" role="status">Loading session…</p>}
    {Boolean(sessions?.length) && <ul className="meet-room-list">
      {sessions.map(session => {
        const highlighted = String(session.id) === requestedId;
        const isCall = session.mode === 'call';
        return <li className={`meet-room meet-scheduled-card${highlighted ? ' meet-scheduled-highlight' : ''}`}
          key={session.id} ref={highlighted ? target : null}>
          <span className="meet-room-icon" aria-hidden="true"><Icon name={isCall ? 'mic' : 'talk'} size={19}/></span>
          <span className="meet-room-name">
            <strong>{session.title}</strong>
            <small>{isCall ? 'Voice call' : 'Text chat'} · {session.live ? 'Live now' : 'Upcoming'}</small>
            <small>{session.live ? 'Ends ' : 'Starts '}
              <time dateTime={session.live ? session.ends_at : session.starts_at}>
                {dateTime.format(new Date(session.live ? session.ends_at : session.starts_at))}
              </time>
            </small>
          </span>
          {session.live ? <button type="button" className="meet-scheduled-button live" disabled={loadError || !canJoin(session.mode)}
            onClick={() => onJoin(session.mode)}>{isCall ? 'Join call' : 'Join chat'}</button>
            : <button type="button" className="meet-scheduled-button" aria-pressed={session.reminded} disabled={saving || loadError}
              aria-label={`Remind me about ${session.title}`} onClick={() => toggleReminder(session)}>
              {session.reminded ? 'Reminder set' : 'Remind me'}
            </button>}
        </li>;
      })}
    </ul>}
  </section>;
}
