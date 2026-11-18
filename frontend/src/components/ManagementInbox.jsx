import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import Icon from './Icon';

const endpoint = '/profile/management-notices';
const titles = {
  warn: 'Account warning', restrict: 'Account temporarily restricted', unrestrict: 'Restriction lifted',
  ban: 'Account suspended', unban: 'Account restored', premium: 'Premium added', unpremium: 'Premium removed',
  hide_post: 'Post hidden', restore_post: 'Post restored'
};
const appealableActions = new Set(['warn', 'restrict', 'ban', 'hide_post', 'unpremium']);
const noticeDetails = {
  warn: ['Account safety', 'warning'],
  restrict: ['Account safety', 'warning', 'Sending messages and publishing posts were temporarily limited.'],
  unrestrict: ['Account safety', 'restored', 'The temporary limits on messaging and posting were lifted.'],
  ban: ['Account safety', 'warning', 'This decision blocked access to your account.'],
  unban: ['Account safety', 'restored'],
  premium: ['Membership', 'membership'],
  unpremium: ['Membership', 'membership'],
  hide_post: ['Post moderation', 'warning', 'Management hid a post from other members.'],
  restore_post: ['Post moderation', 'restored', 'Management restored the post to its original audience.'],
};
const noticeDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const appealStatuses = {
  pending: 'Awaiting review',
  reviewing: 'Under review',
  resolved: 'Review closed',
  dismissed: 'Dismissed',
};

function ReviewRequest({ noticeId, appeals = [] }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (busy || details.trim().length < 10) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/reports', {
        kind: 'appeal', reason: 'moderation_appeal', noticeId, details: details.trim(),
        contextPath: '/matches/management'
      });
      setReceipt(data);
      setOpen(false);
    } catch (error) {
      setError(error.response?.data?.error || 'Unable to send your request for review.');
    } finally {
      setBusy(false);
    }
  }

  const cases = receipt && !appeals.some(appeal => appeal.id === receipt.id) ? [receipt, ...appeals] : appeals;
  const hasOpenCase = cases.some(appeal => ['pending', 'reviewing'].includes(appeal.status));

  return <div className="management-review">
    {cases.length > 0 && <div className="management-notice-details mb-3" aria-live="polite">
      <p className="font-semibold text-sm">Review requests</p>
      <ul className="space-y-2">
        {cases.map(appeal => <li key={appeal.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <strong>Case #{appeal.id}</strong>
          <span>{appealStatuses[appeal.status]}</span>
        </li>)}
      </ul>
    </div>}
    {!hasOpenCase && <>
      <p className="font-semibold text-sm">Think this was a mistake?</p>
      <p className="mt-1 text-xs text-gray-500">Tell AURA Management what they should reconsider. You’ll receive a case number when you submit.</p>
      {!open ? <button type="button" className="management-review-button" onClick={() => setOpen(true)}>Request a review</button> :
        <form className="mt-2 space-y-2" onSubmit={submit}>
          <label className="block text-sm">Why should we review this decision?
            <textarea className="aura-input mt-2" required rows={3} minLength={10} maxLength={1900} disabled={busy}
              value={details} onChange={event => setDetails(event.target.value)} />
          </label>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} className="aura-btn-secondary !py-2" onClick={() => setOpen(false)}>Cancel</button>
            <button disabled={busy || details.trim().length < 10} className="aura-btn-primary !py-2">{busy ? 'Sending…' : 'Send request'}</button>
          </div>
        </form>}
    </>}
  </div>;
}

function ManagementNotice({ notice }) {
  const [category, tone, explanation] = noticeDetails[notice.action] || ['Account update', 'membership'];
  return <article className={`aura-card management-notice management-notice--${tone}`}>
    <header>
      <span className="management-notice-category">{category}</span>
      <h3>{titles[notice.action] || 'Account update'}</h3>
      {explanation && <p className="management-notice-explanation">{explanation}</p>}
    </header>
    <dl className="management-notice-details">
      <div>
        <dt>Reason given</dt>
        <dd className="whitespace-pre-wrap break-words">{notice.reason || 'No reason recorded.'}</dd>
      </div>
      <div>
        <dt>Issued on</dt>
        <dd><time dateTime={notice.created_at}>{noticeDate.format(new Date(notice.created_at))}</time></dd>
      </div>
      {notice.effective_until && <div>
        <dt>{notice.action === 'premium' ? 'Scheduled Premium expiry' : 'Scheduled end'}</dt>
        <dd><time dateTime={notice.effective_until}>{noticeDate.format(new Date(notice.effective_until))}</time></dd>
      </div>}
    </dl>
    {appealableActions.has(notice.action) && <ReviewRequest noticeId={notice.id} appeals={notice.appeals}/>}
  </article>;
}

export function useManagementInboxSummary(enabled) {
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    let request;
    const refresh = () => {
      if (document.hidden) return;
      request?.abort();
      request = new AbortController();
      const { signal } = request;
      api.get(endpoint, { params: { summary: 1 }, signal })
        .then(({ data }) => { if (!signal.aborted) setSummary(data); }).catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    window.addEventListener('aura:management-change', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      request?.abort();
      clearInterval(timer);
      window.removeEventListener('aura:management-change', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled]);
  return enabled ? summary : null;
}

export function ManagementInboxRow({ notice, timestamp, unread }) {
  return <Link to="/matches/management" className="conversation-row text-inherit no-underline">
    <span className="connection-avatar shrink-0 rounded-full grid place-items-center bg-aura-elevated text-aura-violet-light"><Icon name="lock" size={19}/></span>
    <div className="connection-thread flex-1 min-w-0">
      <span className={`connection-thread-name ${unread ? 'font-bold' : 'font-semibold'}`}>AURA Management</span>
      <p className="connection-thread-preview text-gray-400 truncate">{titles[notice.action] || 'Account update'}</p>
    </div>
    <div className="connection-thread-meta">
      <time className="text-gray-500" dateTime={notice.created_at}>{timestamp}</time>
      {unread && <span role="img" aria-label="Unread" className="connection-unread-dot bg-aura-pink"/>}
    </div>
  </Link>;
}

export default function ManagementInbox() {
  const [notices, setNotices] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let request;
    const refresh = async () => {
      if (document.hidden) return;
      request?.abort();
      request = new AbortController();
      const { signal } = request;
      try {
        const { data } = await api.get(endpoint, { signal });
        if (signal.aborted) return;
        setNotices(data.notices);
        setHasMore(data.hasMore);
        setError('');
        if (data.notices[0] && !document.hidden) {
          await api.post(endpoint + '/read', { throughId: data.notices[0].id }, { signal });
          window.dispatchEvent(new Event('aura:unread-change'));
        }
      } catch {
        if (!signal.aborted) setError('Unable to refresh AURA Management messages.');
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    };
    refresh();
    window.addEventListener('aura:management-change', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      request?.abort();
      window.removeEventListener('aura:management-change', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  async function loadOlder() {
    setPaging(true);
    setError('');
    try {
      const { data } = await api.get(endpoint, { params: { before: notices.at(-1).id } });
      setNotices(previous => [...new Map([...previous, ...data.notices].map(notice => [notice.id, notice])).values()]);
      setHasMore(data.hasMore);
    } catch {
      setError('Unable to load older messages.');
    } finally {
      setPaging(false);
    }
  }

  return <main className="mobile-tab-screen min-h-screen bg-aura-deep">
    <header className="profile-page-bar">
      <Link to="/matches" aria-label="Back to Connections">←</Link>
      <h1 className="font-semibold">AURA Management</h1>
      <Icon name="lock" size={17}/>
    </header>
    <section className="management-history" aria-labelledby="management-history-title">
      <div className="management-history-intro">
        <h2 id="management-history-title">Notice history</h2>
        <p>Decisions about your account, posts, and Premium access. Newest notices appear first.</p>
      </div>
      {loading && <p role="status">Loading notices…</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!loading && !error && !notices.length && <p className="text-sm text-gray-400">No management messages yet.</p>}
      {notices.map(notice => <ManagementNotice key={notice.id} notice={notice}/>)}
      {hasMore && <button className="aura-btn-secondary" disabled={paging} onClick={loadOlder}>{paging ? 'Loading…' : 'Load older messages'}</button>}
    </section>
  </main>;
}
