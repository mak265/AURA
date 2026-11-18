import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client';
import Icon from './Icon';

export function SavePostButton({ post, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saved = Boolean(post.saved_by_me);
  const label = saved ? 'Remove from Saved' : 'Save post';

  async function toggle() {
    setBusy(true);
    setError('');
    try {
      const method = saved ? 'delete' : 'put';
      const { data } = await api[method](`/feed/${post.id}/save`);
      onSaved(data.saved_by_me);
    } catch (error) {
      setError(error.response?.data?.error || 'Could not update Saved. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="relative shrink-0">
    <button type="button" title={label} aria-label={label} aria-pressed={saved} disabled={busy}
      className={`journal-post-tool ${saved ? 'is-saved' : ''}`} onClick={toggle}>
      <Icon name="bookmark" size={18}/>
    </button>
    {error && <p role="alert" className="absolute z-10 right-0 top-full w-40 rounded-lg border border-aura-border bg-aura-elevated p-2 text-xs">{error}</p>}
  </div>;
}

function EditPostDialog({ post, onClose, onEdited }) {
  const dialog = useRef(null);
  const [caption, setCaption] = useState(post.caption || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await api.patch(`/feed/${post.id}`, { caption });
      onEdited(data);
      onClose();
    } catch (error) {
      setError(error.response?.data?.error || 'Could not edit the post. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return createPortal(<dialog ref={dialog} className="message-confirm-dialog journal-edit-dialog" aria-labelledby="journal-edit-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={save}>
      <h2 id="journal-edit-title">Edit post</h2>
      <label className="sr-only" htmlFor="journal-edit-caption">Caption</label>
      <textarea id="journal-edit-caption" className="aura-input resize-y" rows={5} maxLength={5000} value={caption}
        disabled={busy} onChange={event => setCaption(event.target.value)} autoFocus/>
      {error && <p role="alert" className="message-confirm-error">{error}</p>}
      <div className="message-confirm-actions">
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={busy || (!caption.trim() && !post.image_url) || caption.trim() === (post.caption || '')}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  </dialog>, document.body);
}

export function EditPostButton({ post, onEdited }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" title="Edit post" aria-label="Edit post" className="journal-post-tool" onClick={() => setOpen(true)}><Icon name="edit" size={17}/></button>
    {open && <EditPostDialog post={post} onClose={() => setOpen(false)} onEdited={onEdited}/>}
  </>;
}
