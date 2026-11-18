import Icon from './Icon';
import { useRef, useState } from 'react';
const AUDIENCES = [['public','Public'],['connections','Connections only'],['private','Myself only']];
export default function PostAudience({ value = 'public', onChange, disabled = false, label = 'Post audience', confirmRealProfile = false }) {
  const dialog = useRef(null);
  const [pending, setPending] = useState(null);
  const audienceIndex = id => AUDIENCES.findIndex(([option]) => option === id);
  function change(next) {
    if (confirmRealProfile && audienceIndex(next) < audienceIndex(value)) {
      setPending(next);
      dialog.current.showModal();
    } else onChange(next);
  }
  return onChange ? <><label className="audience-control text-[11px] text-gray-400 inline-flex items-center gap-1.5"><Icon name={value==='private'?'lock':value==='connections'?'people':'globe'} size={12}/><span className="sr-only">{label}</span><select aria-label={label} value={value} disabled={disabled} onChange={event=>change(event.target.value)} className="bg-aura-elevated border border-aura-border rounded-lg px-2 py-2 text-xs text-gray-300">{AUDIENCES.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    {confirmRealProfile && <dialog ref={dialog} className="message-confirm-dialog" aria-label="Share your real profile with more people">
      <h2>Share with more people?</h2>
      <p>Changing this post to {AUDIENCES[audienceIndex(pending)]?.[1]} lets more people see your real name and profile photo.</p>
      <div className="message-confirm-actions">
        <button autoFocus type="button" onClick={() => dialog.current.close()}>Keep audience</button>
        <button type="button" onClick={() => { dialog.current.close(); if (pending) onChange(pending, true); }}>Change audience</button>
      </div>
    </dialog>}
  </> : <span className="inline-flex items-center gap-1 text-[10px] text-gray-400"><Icon name={value==='private'?'lock':value==='connections'?'people':'globe'} size={11}/>{AUDIENCES[audienceIndex(value)]?.[1] || 'Public'}</span>;
}
