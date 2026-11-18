import { useEffect, useId, useRef, useState } from 'react';

const OPENER_LIMIT = 160;

export default function DiscoverAuraComposer({ name, prompt, replying = false, onSend, onClose }) {
  const dialog = useRef(null);
  const title = useId();
  const guidance = useId();
  const counter = useId();
  const [opener, setOpener] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const submit = async event => {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setError('');
    try {
      await onSend(opener.trim());
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to send Aura. Try again.');
      setSending(false);
    }
  };

  return <dialog
    ref={dialog}
    className="discover-opener-dialog"
    aria-labelledby={title}
    onCancel={event => {
      event.preventDefault();
      if (!sending) onClose();
    }}
  >
    <form onSubmit={submit}>
      <h2 id={title}>{replying ? 'Send an Aura back to' : 'Send an Aura to'} {name}</h2>
      {prompt && <div className="discover-prompt discover-opener-context">
        <p>{prompt.question}</p>
        <blockquote>{prompt.answer}</blockquote>
      </div>}
      <label className="discover-opener-label">
        Opener <span>(optional)</span>
        <textarea
          className="aura-input"
          aria-describedby={`${guidance} ${counter}`}
          rows={3}
          maxLength={OPENER_LIMIT}
          placeholder={replying ? 'Write a short reply…' : prompt ? 'Ask them about their answer…' : 'Say hello or ask a question…'}
          value={opener}
          onChange={event => setOpener(event.target.value)}
          disabled={sending}
        />
      </label>
      <div className="discover-opener-help">
        <p id={guidance}>Only you and {name} can see your opener.</p>
        <span id={counter}>{opener.length}/{OPENER_LIMIT}</span>
      </div>
      {error && <p role="alert" className="discover-opener-error">{error}</p>}
      <div className="discover-card-actions">
        <button type="button" className="aura-btn-secondary" onClick={onClose} disabled={sending}>Cancel</button>
        <button className="aura-btn-primary" disabled={sending}>{sending ? 'Sending…' : replying ? 'Send Aura back' : 'Send Aura'}</button>
      </div>
    </form>
  </dialog>;
}
