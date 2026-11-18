import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import './connection-plans.css';

const dateTime = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

function planError(error) {
  return error.response?.data?.error || 'Couldn’t save the plan. Try again.';
}

function PlanTimeDialog({ isCounter, onSubmit, onClose }) {
  const [type, setType] = useState('call');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const pending = useRef(null);
  const busy = useRef(false);
  const title = useId();

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (busy.current) return;
    const date = new Date(time);
    if (!(date.getTime() > Date.now())) {
      setError('Choose a date and time in the future.');
      return;
    }
    const proposedAt = date.toISOString();
    if (pending.current?.type !== type || pending.current.proposedAt !== proposedAt) {
      pending.current = { type, proposedAt, clientPlanId: crypto.randomUUID() };
    }
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      await onSubmit(pending.current);
      onClose();
    } catch (failure) {
      setError(planError(failure));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return createPortal(
    <dialog ref={dialog} className="connection-plan-dialog" aria-labelledby={title} onCancel={event => {
      event.preventDefault();
      if (!busy.current) onClose();
    }}>
      <form onSubmit={submit}>
        <h2 id={title}>{isCounter ? 'Suggest another time' : 'Make a plan'}</h2>
        {!isCounter && <label>Plan type
          <select value={type} onChange={event => setType(event.target.value)} disabled={saving}>
            <option value="call">Call</option>
            <option value="meetup">Meetup</option>
          </select>
        </label>}
        <label>Date and time
          <input type="datetime-local" value={time} onChange={event => setTime(event.target.value)} required disabled={saving}/>
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="connection-plan-actions">
          <button type="submit" className="connection-plan-primary" disabled={saving}>{saving ? 'Sending…' : 'Send proposal'}</button>
          <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

export function ConnectionPlanComposer({ onCreate }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="connection-plan-trigger" type="button" onClick={() => setOpen(true)}>Make a plan</button>
    {open && <PlanTimeDialog onSubmit={onCreate} onClose={() => setOpen(false)}/>}
  </>;
}

export function ConnectionPlanCard({ plan, myId, checkedAt, onRespond }) {
  const [suggesting, setSuggesting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');
  const agreed = Boolean(plan.agreed_at);
  const mine = plan.proposer_id === myId;
  const expired = !agreed && Date.parse(plan.proposed_at) <= checkedAt;
  const canRespond = myId != null && !agreed && !mine;
  const time = plan.agreed_at || plan.proposed_at;
  let status = mine ? 'You proposed this time' : 'Your connection proposed this time';
  if (agreed) status = 'Agreed time';
  if (expired) status = 'Proposed time has passed';

  async function accept() {
    setAccepting(true);
    setError('');
    try {
      await onRespond(plan, 'accept');
    } catch (failure) {
      setError(planError(failure));
    } finally {
      setAccepting(false);
    }
  }

  return <article className="connection-plan-card">
    <header>
      <span className="connection-plan-icon"><Icon name={plan.type === 'call' ? 'phone' : 'people'} size={18}/></span>
      <div>
        <strong>{plan.type === 'call' ? 'Call plan' : 'Meetup plan'}</strong>
        <p aria-live="polite">{status}</p>
        <time dateTime={time}>{dateTime.format(new Date(time))}</time>
      </div>
    </header>
    {canRespond && <div className="connection-plan-actions">
      {!expired && <button className="connection-plan-primary" type="button" onClick={accept} disabled={accepting}>
        {accepting ? 'Accepting…' : 'Accept'}
      </button>}
      <button type="button" onClick={() => setSuggesting(true)} disabled={accepting}>Suggest another time</button>
    </div>}
    {error && <p className="connection-plan-error" role="alert">{error}</p>}
    {canRespond && suggesting && <PlanTimeDialog isCounter key={plan.revision}
      onSubmit={({ proposedAt }) => onRespond(plan, 'suggest', proposedAt)}
      onClose={() => setSuggesting(false)}/>}
  </article>;
}
