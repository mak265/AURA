import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client';
import Icon from './Icon';

export default function DeleteAccountButton({ onDeleted, onSignInAgain }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [signInAgain, setSignInAgain] = useState(false);
  const dialog = useRef(null);

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const trigger = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);

  async function remove(event) {
    event.preventDefault();
    if (busy || confirmation !== 'DELETE') return;
    setBusy(true);
    setError('');
    try {
      await api.delete('/profile/account', { data: { confirmation } });
      onDeleted();
    } catch (error) {
      setSignInAgain(error.response?.data?.code === 'RECENT_LOGIN_REQUIRED');
      setError(error.response?.data?.error || 'Unable to delete your account.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button type="button" className="settings-delete-trigger" onClick={() => {
      setConfirmation('');
      setError('');
      setSignInAgain(false);
      setOpen(true);
    }}><Icon name="trash" size={17}/> Delete account</button>
    {open && createPortal(<dialog ref={dialog} className="report-dialog" aria-labelledby="delete-account-title"
      onCancel={event => { event.preventDefault(); if (!busy) setOpen(false); }}>
      <form onSubmit={remove}>
        <h2 id="delete-account-title">Delete your AURA account?</h2>
        <p className="report-help">This permanently removes your profile, posts, Glimpses, and conversations from AURA. Copies already retained in other people’s safety reports follow the report retention period.</p>
        <label>Type DELETE to confirm
          <input className="aura-input" autoComplete="off" value={confirmation} disabled={busy}
            onChange={event => setConfirmation(event.target.value)} />
        </label>
        {error && <p role="alert" className="report-error">{error}</p>}
        <div className="report-actions">
          <button type="button" className="aura-btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          {signInAgain
            ? <button type="button" className="aura-btn-primary" onClick={onSignInAgain}>Sign in again</button>
            : <button className="aura-btn-primary" disabled={busy || confirmation !== 'DELETE'}>{busy ? 'Deleting…' : 'Permanently delete'}</button>}
        </div>
      </form>
    </dialog>, document.body)}
  </>;
}
