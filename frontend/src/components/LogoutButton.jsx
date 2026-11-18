import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function LogoutButton({ onConfirm, className, disabled, allDevices = false, children = 'Log out' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const trigger = useRef(null);

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element.showModal();
    return () => {
      element.close();
      trigger.current?.focus();
    };
  }, [open]);

  async function confirm() {
    setBusy(true);
    setError('');
    try { await onConfirm(); setOpen(false); }
    catch (err) { setError(err.response?.data?.error || 'Couldn’t log out. Try again.'); }
    finally { setBusy(false); }
  }

  return <>
    <button ref={trigger} type="button" className={className} disabled={disabled} onClick={() => {setError('');setOpen(true);}}>{children}</button>
    {open && createPortal(<dialog ref={dialog} className="report-dialog" aria-label="Confirm log out"
      onCancel={event => { event.preventDefault(); if(!busy)setOpen(false); }}>
      <h2 className="text-lg font-semibold">{allDevices ? 'Log out of all devices?' : 'Log out of AURA?'}</h2>
      <p className="report-help">{allDevices ? 'This signs you out everywhere, including this device.' : 'You’ll need to sign in again to use your account on this device.'}</p>
      {error && <p role="alert" className="report-error">{error}</p>}
      <div className="report-actions">
        <button type="button" autoFocus disabled={busy} className="aura-btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" disabled={busy} className="aura-btn-primary" onClick={confirm}>{busy ? 'Logging out…' : allDevices ? 'Log out everywhere' : 'Log out'}</button>
      </div>
    </dialog>, document.body)}
  </>;
}
