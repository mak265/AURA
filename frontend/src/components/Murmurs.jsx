import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client';
import Avatar from './Avatar';
import Icon from './Icon';
import { useAuth } from '../context/AuthContext';
import './murmurs.css';

export default function Murmurs() {
  const { user } = useAuth();
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editor = useRef(null);
  const own = notes.find(note => note.own);
  const others = notes.filter(note => !note.own);
  const length = Array.from(draft).length;
  const photo = own?.profile_photo || user?.user?.profile_photo;
  const avatarName = user?.user?.real_name || user?.aura?.aura_name || 'You';

  useEffect(() => {
    if (!editing) return;
    const dialog = editor.current;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, [editing]);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/murmurs', { signal: controller.signal })
      .then(({ data }) => setNotes(data))
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not load Murmurs.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!notes.length) return;
    const nextExpiry = Math.min(...notes.map(note => Date.parse(note.expires_at)));
    const timer = setTimeout(() => {
      setNotes(previous => previous.filter(note => Date.parse(note.expires_at) > Date.now()));
    }, Math.max(0, nextExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [notes]);

  async function save(event) {
    event.preventDefault();
    if (busy || !draft.trim() || length > 80) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.put('/murmurs/mine', { body: draft });
      setNotes(previous => [data, ...previous.filter(note => !note.own)]);
      setEditing(false);
    } catch (error) {
      setError(error.response?.data?.error || 'Could not share your Murmur.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api.delete('/murmurs/mine');
      setNotes(previous => previous.filter(note => !note.own));
      setEditing(false);
    } catch {
      setError('Could not remove your Murmur.');
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="Murmurs" className="murmur-panel">
    <div className="murmur-heading">
      <h2><Icon name="spark" size={15}/> Murmurs</h2>
      <span>Connections · 24h</span>
    </div>
    <div className="murmur-strip">
      <button type="button" aria-label={own ? 'Edit your Murmur' : 'Leave a Murmur'} disabled={loading || busy} onClick={() => {
        setDraft(own?.body || '');
        setEditing(true);
        setError('');
      }} className="murmur-tile murmur-tile-own">
        <span className={`murmur-bubble${own ? '' : ' murmur-bubble-empty'}`}>{own?.body || 'Leave a Murmur'}</span>
        <span className="murmur-person">
          <Avatar src={photo} name={avatarName} size={64}/>
          <span className="murmur-action" aria-hidden="true">{own ? <Icon name="edit" size={12}/> : '+'}</span>
        </span>
        <span className="murmur-name">You</span>
      </button>
      {others.map(note => <div key={note.user_id} className="murmur-tile">
        <p className="murmur-bubble">{note.body}</p>
        <div className="murmur-person">
          <Avatar src={note.profile_photo} name={note.aura_name || 'Aura'} size={64}/>
        </div>
        <span className="murmur-name">{note.aura_name || 'Aura'}</span>
      </div>)}
    </div>
    {editing && createPortal(<dialog ref={editor} className="murmur-editor" aria-labelledby="murmur-editor-title"
      onCancel={event => { event.preventDefault(); if (!busy) setEditing(false); }}>
      <form onSubmit={save}>
        <header className="murmur-editor-header">
          <div><h2 id="murmur-editor-title">{own ? 'Edit your Murmur' : 'Leave a Murmur'}</h2><p>Visible to connections for 24 hours</p></div>
          <button type="button" className="murmur-editor-close" disabled={busy} aria-label="Close editor" onClick={() => setEditing(false)}>×</button>
        </header>
        <div className="murmur-editor-preview">
          <span className="murmur-bubble">{draft.trim() || 'Your note goes here'}</span>
          <Avatar src={photo} name={avatarName} size={48}/>
        </div>
        <label className="sr-only" htmlFor="murmur-draft">Your note</label>
        <div className="murmur-editor-input">
          <textarea id="murmur-draft" rows={2} placeholder="What’s on your mind?" value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} />
          <span className={length > 80 ? 'murmur-over-limit' : ''}>{length}/80</span>
        </div>
        {error && <p role="alert" className="murmur-over-limit text-sm">{error}</p>}
        <button className="murmur-editor-save" disabled={busy || !draft.trim() || length > 80}>{busy ? 'Saving…' : own ? 'Save changes' : 'Share Murmur'}</button>
        {own && <button type="button" className="murmur-editor-remove" disabled={busy} onClick={remove}>Remove Murmur</button>}
      </form>
    </dialog>, document.body)}
    {!editing && error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
  </section>;
}
