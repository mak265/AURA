import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import api from '../api/client';
import useActivity from '../hooks/useActivity';

const icons = { aura: 'heart', 'glimpse-reply': 'talk', 'lounge-invite': 'people', 'meet-session': 'mic' };

function messageFor(item) {
  if (item.id.startsWith('journal-reaction:') && item.actor_count > 1) {
    return item.actor_name ? `${item.actor_name} and ${item.actor_count - 1} ${item.actor_count === 2 ? 'other' : 'others'} reacted to your post.` : `${item.actor_count} people reacted to your post.`;
  }
  return item.actor_name ? item.body.replace(/^Someone/, item.actor_name) : item.body;
}

export default function JournalActivity() {
  const { items, unread, loading, error } = useActivity();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const navigate = useNavigate();
  const { state } = useLocation();

  const markRead = async id => {
    setSaving(true);
    setSaveError('');
    try {
      await api.patch('/activity/read', { id });
      window.dispatchEvent(new Event('aura:activity-change'));
    } catch {
      setSaveError('Couldn’t mark notifications as read. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const openActivity = async item => {
    if (!item.read) await markRead(item.id);
    navigate(item.path);
  };

  return <section className="journal-activity">
    <header className="journal-activity-header">
      <Link to={state?.returnTo || '/feed'} replace className="mobile-icon-action" aria-label="Back">←</Link>
      <h1>Activity</h1>
      <button disabled={!unread || saving} onClick={()=>markRead()} className="journal-mark-read">Mark all read</button>
    </header>
    {saveError && <p role="alert" className="journal-activity-intro">{saveError}</p>}
    {loading || error || !items.length ? <p className="journal-activity-intro" role="status">
      {loading ? 'Loading notifications…' : error || 'You’re all caught up.'}
    </p> : <ul className="journal-activity-list mt-4">
      {items.map(item=><li key={item.id}>
        <button disabled={saving} onClick={()=>openActivity(item)} className={item.read ? '' : 'journal-activity-unread'}>
          <span className="journal-activity-icon"><Icon name={icons[item.source] || (item.body.includes('reacted') ? 'heart' : 'talk')} size={18}/></span>
          <span>
            <span>{messageFor(item)}</span>
            {item.detail && <p className="text-xs text-gray-400 mt-1 break-words">{item.detail}</p>}
            <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
          </span>
          {!item.read && <span className="journal-unread-dot" aria-label="Unread"/>}
        </button>
      </li>)}
    </ul>}
  </section>;
}
