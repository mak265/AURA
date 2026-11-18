import ContentSkeleton from '../components/ContentSkeleton';
import { useDeviceSettings } from '../hooks/useDeviceSettings';
import ConversationMenu, { ConversationPressable } from '../components/ConversationMenu';
import ConversationPreview from '../components/ConversationPreview';
import PresenceStatus from '../components/PresenceStatus';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import AppTopBar from '../components/AppTopBar';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import Murmurs from '../components/Murmurs';
import { ManagementInboxRow, useManagementInboxSummary } from '../components/ManagementInbox';
import './matches.css';

const CHAT_FILTERS = ['all', 'revealed', 'hidden', 'archived'];
const MESSAGE_ICONS = { image: 'photo', audio: 'mic', call: 'phone' };

export default function Matches() {
  const [device]=useDeviceSettings();
  const [selectedConversation,setSelectedConversation]=useState(null);
  const [previewConversation, setPreviewConversation] = useState(null);
  const [requests,setRequests]=useState([]);
  const [sentRequests,setSentRequests]=useState([]);
  const [requestTab,setRequestTab]=useState('received');
  const [requestBusy,setRequestBusy]=useState(null);
  const [error,setError]=useState('');
  const [matches, setMatches] = useState([]);
  const [section, setSection] = useState('chats');
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const management = useManagementInboxSummary(true);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const isChats = section === 'chats';
  const unreadChats = matches.filter(match => !match.archived && match.unread > 0).length + Number(Boolean(management?.unread));

  const fetchMatches = useCallback(() => Promise.all([
    api.get('/matches'),
    api.get('/aura-requests'),
    api.get('/aura-requests?direction=sent'),
  ]).then(([chats, inbox, sent]) => {
    setMatches(chats.data);
    setRequests(inbox.data);
    setSentRequests(sent.data);
  }).catch(error => console.error(error)).finally(() => setLoading(false)), []);

  useEffect(() => {
    fetchMatches();
    const interval = setInterval(fetchMatches, 3000);
    window.addEventListener('aura:unread-change', fetchMatches);
    return () => {
      clearInterval(interval);
      window.removeEventListener('aura:unread-change', fetchMatches);
    };
  }, [fetchMatches]);

  const handleRequest=async(id,action)=>{
    setRequestBusy(id);setError('');
    try{const response=await api.post(`/aura-requests/${id}/${action}`);await fetchMatches();if(response.data.status==='accepted')navigate(`/chat/${response.data.matchId}`);}
    catch(err){setError(err.response?.data?.error||'Unable to update request.');}finally{setRequestBusy(null);}
  };
  const filtered = matches.filter(m => {
    const visibleLabel = m.last_message_kind === 'audio' ? 'Voice note' : m.last_message;
    if (query && ![m.aura_name, m.last_message, visibleLabel].some(value => value?.toLocaleLowerCase().includes(query))) return false;
    if(tab==='archived')return m.archived;
    if(m.archived)return false;
    if (tab === 'revealed') return m.revealed;
    if (tab === 'hidden') return !m.revealed;
    return true;
  });
  const conversations = filtered.map(match => ({
    match, pinned: Boolean(match.pinned), activity: Date.parse(match.last_message_at || match.created_at)
  }));
  if (tab === 'all' && management?.latest && 'aura management'.includes(query)) {
    conversations.push({ pinned: false, activity: Date.parse(management.latest.created_at) });
  }
  conversations.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.activity - a.activity);

  const handleMatchClick = (m) => {
    navigate(`/chat/${m.id}`);
  };

  return (
    <div className="mobile-tab-screen connections-screen min-h-screen bg-aura-deep pb-24">
      <AppTopBar title="Connections"/>
      <div className="connection-sections" role="group" aria-label="Connections inbox">
        <button type="button" aria-pressed={isChats} onClick={() => setSection('chats')}>
          Chats
          {device.badges && unreadChats > 0 && <InboxCount count={unreadChats} label={unreadChats === 1 ? 'unread chat' : 'unread chats'}/>}
        </button>
        <button type="button" aria-pressed={!isChats} onClick={() => setSection('requests')}>
          Requests
          {requests.length > 0 && <InboxCount count={requests.length} label={requests.length === 1 ? 'pending request' : 'pending requests'}/>}
        </button>
      </div>

      {isChats && <Murmurs/>}
      {isChats && <div className="connection-search">
        <Icon name="discover" size={20}/>
        <input type="search" aria-label="Search conversations" placeholder="Search conversations"
          value={search} onChange={event => setSearch(event.target.value)}/>
      </div>}
      {isChats && <div className="connection-filters" role="group" aria-label="Filter conversations">
        {CHAT_FILTERS.map(t => (
          <button
            type="button"
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className="font-semibold capitalize"
          >
            {t}
          </button>
        ))}
      </div>}

      {error&&<p role="alert" className="px-5 text-xs text-red-400 mb-4">{error}</p>}
      {loading ? (
        <ContentSkeleton compact/>
      ) : !isChats ? (
        <section aria-label="Message requests" className="px-5 space-y-4">
          <div className="connection-request-filters" role="group" aria-label="Request direction">
            <button type="button" aria-pressed={requestTab === 'received'} onClick={() => setRequestTab('received')}>Received ({requests.length})</button>
            <button type="button" aria-pressed={requestTab === 'sent'} onClick={() => setRequestTab('sent')}>Sent ({sentRequests.length})</button>
          </div>
          {requestTab === 'sent' ? <div className="space-y-4">
            {sentRequests.length === 0 ? <p className="aura-card p-6 text-sm text-gray-400">You have not sent any Aura requests yet.</p> : sentRequests.map(request => (
              <article key={request.id} className="aura-card p-4 space-y-3">
                <div className="flex justify-between gap-3">
                  <h3 className="text-sm font-semibold">To {request.aura_name || 'an Aura'}</h3>
                  <span className="text-xs text-aura-violet-light capitalize">{request.status}</span>
                </div>
                <JournalRequestPreview preview={request.post_preview}/>
                <p className="text-sm bg-aura-elevated p-3 rounded-xl whitespace-pre-wrap break-words">{request.opening_message}</p>
                <p className="text-[10px] text-gray-400">{new Date(request.created_at).toLocaleString()}</p>
                {request.status === 'accepted' && request.match_id ?
                  <button className="aura-btn-primary !py-2 text-xs" onClick={() => navigate(`/chat/${request.match_id}`)}>Open conversation</button> :
                  <p className="text-xs text-gray-400">{request.status === 'pending' ? 'Waiting for them to accept.' : 'This request was declined.'}</p>}
              </article>
            ))}
          </div> : requests.length === 0 ? <p className="aura-card p-6 text-sm text-gray-400">No message requests right now.</p> : requests.map(request => (
            <article key={request.id} className="aura-card p-4 space-y-3">
              <h3 className="font-semibold text-sm">{request.aura_name || 'A new Aura'}</h3>
              {request.bio && <p className="text-xs text-gray-400">{request.bio}</p>}
              <JournalRequestPreview preview={request.post_preview}/>
              <p className="text-sm bg-aura-elevated rounded-xl p-3 whitespace-pre-wrap break-words">{request.opening_message}</p>
              <p className="text-[10px] text-gray-400">Accept to open an anonymous conversation. Identities stay hidden until mutual reveal.</p>
              <div className="flex gap-3">
                <button className="aura-btn-secondary !py-2 text-xs" disabled={requestBusy === request.id} onClick={() => handleRequest(request.id, 'decline')}>Decline</button>
                <button className="aura-btn-primary !py-2 text-xs" disabled={requestBusy === request.id} onClick={() => handleRequest(request.id, 'accept')}>Accept & chat</button>
              </div>
            </article>
          ))}
        </section>
      ) : conversations.length === 0 ? (
        <div className="text-center py-20 px-8">
          <div className="empty-symbol"><Icon name="heart" size={28}/></div>
          <p className="text-gray-400">{query ? 'No conversations match your search.' : tab === 'all' ? 'Your next connection is waiting.' : 'No conversations here yet.'}</p>
          {!query && tab === 'all' && <p className="text-gray-500 text-sm mt-1">Explore more Auras.</p>}
        </div>
      ) : (
        <div className="connection-inbox">
          {conversations.map(({ match: m }) => m ? (
            <ConversationPressable key={m.id} onOpen={()=>handleMatchClick(m)} onMenu={()=>setSelectedConversation(m)} onPreview={()=>setPreviewConversation(m)}>
              <div className="connection-avatar relative shrink-0">
                <Avatar src={m.profile_photo} name={m.aura_name || 'Aura'} size={56}/>
                {m.revealed && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-500 border-2 border-aura-deep flex items-center justify-center text-[8px]">✓</div>
                )}
                {!m.soul_game_completed && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-aura-violet border-2 border-aura-deep flex items-center justify-center text-[8px]"><Icon name="talk" size={10}/></div>
                )}
              </div>
              <div className="connection-thread flex-1 min-w-0">
                <div className="connection-thread-title">
                  <span className={`connection-thread-name ${device.badges && m.unread > 0 ? 'font-bold' : 'font-semibold'}`}>
                    <span className="truncate">{m.aura_name || 'Aura'}</span>
                    {m.pinned&&<Icon name="pin" size={12}/>}
                    {m.muted&&<Icon name="mute" size={12}/>}
                  </span>
                </div>
                {m.high_risk&&<p className="conversation-risk-label"><Icon name="warning" size={12}/>High risk · Only you</p>}
                {m.blocked_by_me&&<p className="text-xs text-red-600 mt-1">Blocked</p>}
                <ThreadPreview match={m}/>
                <PresenceStatus presence={m} compact/>
              </div>
              <div className="connection-thread-meta">
                <time className="text-gray-500" dateTime={m.last_message_at || m.created_at}>{formatTime(m.last_message_at || m.created_at)}</time>
                {device.badges && m.unread > 0 && <InboxCount count={m.unread} label={Number(m.unread) === 1 ? 'unread message' : 'unread messages'}/>}
              </div>
            </ConversationPressable>
          ) : <ManagementInboxRow key="management" notice={management.latest}
            timestamp={formatTime(management.latest.created_at)} unread={device.badges && management.unread}/>)}
        </div>
      )}

      {previewConversation && <ConversationPreview key={previewConversation.id} conversation={previewConversation} onClose={()=>setPreviewConversation(null)}/>}
      {selectedConversation&&<ConversationMenu conversation={selectedConversation} onClose={()=>setSelectedConversation(null)} onAction={async action=>{await api.post(`/matches/${selectedConversation.id}/manage`,{action});window.dispatchEvent(new Event('aura:unread-change'));}}/>}
    </div>
  );
}

function JournalRequestPreview({ preview }) {
  if (!preview) return <p className="text-xs text-gray-400">Journal post unavailable</p>;

  return <Link to={`/feed?post=${preview.id}`} className="block rounded-xl border border-aura-border p-3 text-xs">
    <span className="font-semibold text-aura-violet-light">View Journal post</span>
    {preview.caption && <p className="mt-1 line-clamp-2 break-words">{preview.caption}</p>}
    {preview.has_image && <span className="mt-1 flex items-center gap-1 text-gray-400"><Icon name="photo" size={14}/>Journal photo</span>}
  </Link>;
}

function InboxCount({ count, label }) {
  return <span className="connection-count" role="img" aria-label={`${count} ${label}`}>{count > 99 ? '99+' : count}</span>;
}

function ThreadPreview({ match }) {
  if (!match.soul_game_completed) {
    return <p className="connection-thread-preview truncate"><span className="text-aura-violet-light">Start with a five-minute anonymous chat</span></p>;
  }
  const icon = MESSAGE_ICONS[match.last_message_kind];
  const duration = Math.ceil(match.last_message_duration);
  const label = match.last_message_kind === 'audio' ? 'Voice note' : match.last_message || 'Start a conversation';
  return <p className="connection-thread-preview connection-thread-snippet">
    {icon && <Icon name={icon} size={14}/>}
    <span className="truncate">{label}{duration > 0 && ` · ${duration}s`}</span>
  </p>;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'now';
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
