import { useEffect, useState } from 'react';
import api from '../api/client';

const endpoint = '/admin/meet-sessions';
const initialForm = { title: '', mode: 'chat', startsAt: '', endsAt: '' };
const dateTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', timeZoneName: 'short'
});
const timeZone = dateTime.resolvedOptions().timeZone;

export default function AdminMeetSessions() {
  const [form, setForm] = useState(initialForm);
  const [sessions, setSessions] = useState(null);
  const [version, setVersion] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const { data } = await api.get(endpoint, { signal: controller.signal, timeout: 8000 });
        if (!controller.signal.aborted) {
          setSessions(data.sessions);
          setLoadError(false);
        }
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      }
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [version]);

  async function save(action, success, fallback) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setError(error.response?.data?.error || fallback);
    } finally {
      setBusy(false);
      setVersion(current => current + 1);
    }
  }

  function schedule(event) {
    event.preventDefault();
    save(async () => {
      await api.post(endpoint, {
        title: form.title, mode: form.mode,
        startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString()
      }, { timeout: 8000 });
      setForm(initialForm);
    }, 'Meet session scheduled.', 'Couldn’t schedule the Meet session.');
  }

  function cancel(id) {
    save(async () => {
      await api.post(`${endpoint}/${id}/cancel`, undefined, { timeout: 8000 });
      setConfirmId(null);
    }, 'Meet session cancelled.', 'Couldn’t cancel the Meet session.');
  }

  const field = name => ({
    value: form[name],
    onChange: event => setForm(current => ({ ...current, [name]: event.target.value }))
  });

  return <>
    <div className="admin-heading"><div><h1>Meet sessions</h1><p>Schedule when members can join a chat or voice call.</p></div></div>
    <section className="admin-card">
      <div className="admin-card-title"><div><h2>Schedule a session</h2><p>Times use your device’s time zone ({timeZone}).</p></div></div>
      <form className="admin-meet-form" onSubmit={schedule}>
        <label>Session title<input required maxLength={80} {...field('title')}/></label>
        <label>Session type<select {...field('mode')}><option value="chat">Text chat</option><option value="call">Voice call</option></select></label>
        <label>Starts at<input type="datetime-local" required {...field('startsAt')}/></label>
        <label>Ends at<input type="datetime-local" required {...field('endsAt')}/></label>
        <div><button className="admin-button" disabled={busy}>Schedule session</button></div>
      </form>
    </section>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {message && <p className="admin-meet-feedback" role="status">{message}</p>}
    <section className="admin-card">
      <div className="admin-card-title"><h2>Upcoming and live sessions</h2></div>
      {loadError && <p className="admin-error" role="alert">Couldn’t load Meet sessions. Retrying…</p>}
      {!loadError && !sessions?.length && <p className="admin-meet-feedback" role="status">
        {sessions ? 'There are no upcoming or live Meet sessions.' : 'Loading Meet sessions…'}
      </p>}
      {Boolean(sessions?.length) && <div className="admin-table-scroll"><table>
        <thead><tr><th>Session</th><th>Starts</th><th>Ends</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{sessions.map(session => <tr key={session.id}>
          <td>{session.title}<small className="admin-block">{session.mode === 'call' ? 'Voice call' : 'Text chat'}</small></td>
          <td>{dateTime.format(new Date(session.starts_at))}</td>
          <td>{dateTime.format(new Date(session.ends_at))}</td>
          <td>{session.live ? 'Live' : 'Upcoming'}</td>
          <td>{!session.live && (confirmId === session.id
            ? <div className="admin-meet-confirm">
              <button type="button" className="admin-button danger" disabled={busy} onClick={() => cancel(session.id)}>Confirm cancellation</button>
              <button type="button" className="admin-text-button" disabled={busy} onClick={() => setConfirmId(null)}>Keep session</button>
            </div>
            : <button type="button" className="admin-text-button" disabled={busy} onClick={() => setConfirmId(session.id)}>Cancel session</button>)}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </>;
}
