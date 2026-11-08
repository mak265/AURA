import ContentSkeleton from '../components/ContentSkeleton';
import { useDeviceSettings } from '../hooks/useDeviceSettings';
import ConversationMenu, { ConversationPressable } from '../components/ConversationMenu';
import PresenceStatus from '../components/PresenceStatus';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import BottomNav from '../components/BottomNav';

export default function Matches() {
  const [device]=useDeviceSettings();
  const [selectedConversation,setSelectedConversation]=useState(null);
  const [requests,setRequests]=useState([]);
  const [sentRequests,setSentRequests]=useState([]);
  const [requestTab,setRequestTab]=useState('received');
  const [requestBusy,setRequestBusy]=useState(null);
  const [error,setError]=useState('');
  const [matches, setMatches] = useState([]);
  const [tab, setTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchMatches();
    const interval=setInterval(fetchMatches,3000);
    return ()=>clearInterval(interval);
  }, []);

  const fetchMatches = async () => {
    try {
      const [res,inbox,sent] = await Promise.all([api.get('/matches'),api.get('/aura-requests'),api.get('/aura-requests?direction=sent')]);
      setMatches(res.data);setRequests(inbox.data);setSentRequests(sent.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRequest=async(id,action)=>{
    setRequestBusy(id);setError('');
    try{const response=await api.post(`/aura-requests/${id}/${action}`);await fetchMatches();if(response.data.status==='accepted')navigate(`/chat/${response.data.matchId}`);}
    catch(err){setError(err.response?.data?.error||'Unable to update request.');}finally{setRequestBusy(null);}
  };
  const filtered = matches.filter(m => {
    if(tab==='archived')return m.archived;
    if(m.archived)return false;
    if (tab === 'revealed') return m.revealed;
    if (tab === 'hidden') return !m.revealed;
    return true;
  });

  const handleMatchClick = (m) => {
    if (m.soul_game_completed) {
      navigate(`/chat/${m.id}`);
    } else {
      navigate(`/aura-chat/${m.id}`);
    }
  };

  return (
    <div className="min-h-screen bg-aura-deep pb-24">
      <div className="page-heading">
        <p className="eyebrow">One conversation at a time</p><h1>Connections</h1>
        <p className="text-sm text-gray-400">{matches.length} auras you've connected with</p>
      </div>

      <div className="flex gap-2 px-5 pb-3 overflow-x-auto whitespace-nowrap">
        {['all', 'revealed', 'hidden', 'archived', 'requests'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold capitalize ${tab === t ? 'bg-gradient-to-r from-aura-violet to-aura-pink text-white' : 'bg-aura-card text-gray-400'}`}
          >
            {t==='requests' ? `Requests (${requests.length})` : t}
          </button>
        ))}
      </div>

      {error&&<p role="alert" className="px-5 text-xs text-red-400 mb-4">{error}</p>}
      {loading ? (
        <div className="text-center py-10 text-gray-400">Loading matches...</div>
      ) : tab==='requests' ? (
        <section aria-label="Message requests" className="px-5 space-y-4">
          <div><h2 className="text-lg font-medium">Message requests</h2><p className="text-xs text-gray-400 mt-1">An Aura caught your interest? Read their message and choose whether to connect.</p></div>
          <div className="flex gap-3"><button className={requestTab==='received'?'text-sm text-aura-violet-light border-b border-aura-violet-light py-2':'text-sm text-gray-400 py-2'} onClick={()=>setRequestTab('received')}>Received ({requests.length})</button><button className={requestTab==='sent'?'text-sm text-aura-violet-light border-b border-aura-violet-light py-2':'text-sm text-gray-400 py-2'} onClick={()=>setRequestTab('sent')}>Sent ({sentRequests.length})</button></div>
          {requestTab==='sent' ? <div className="space-y-4">{sentRequests.length===0?<p className="aura-card p-6 text-sm text-gray-400">You have not sent any Aura requests yet.</p>:sentRequests.map(request=><article key={request.id} className="aura-card p-4 space-y-3"><div className="flex justify-between gap-3"><h3 className="text-sm font-semibold">To {request.aura_name || 'an Aura'}</h3><span className="text-xs text-aura-violet-light capitalize">{request.status}</span></div><p className="text-sm bg-aura-elevated p-3 rounded-xl whitespace-pre-wrap break-words">{request.opening_message}</p><p className="text-[10px] text-gray-400">{new Date(request.created_at).toLocaleString()}</p>{request.status==='accepted'&&request.match_id?<button className="aura-btn-primary !py-2 text-xs" onClick={()=>navigate(`/chat/${request.match_id}`)}>Open conversation</button>:<p className="text-xs text-gray-400">{request.status==='pending'?'Waiting for them to accept.':'This request was declined.'}</p>}</article>)}</div> : requests.length===0?<p className="aura-card p-6 text-sm text-gray-400">No message requests right now.</p>:requests.map(request=><article key={request.id} className="aura-card p-4 space-y-3"><h3 className="font-semibold text-sm">{request.aura_name || 'A new Aura'}</h3>{request.bio&&<p className="text-xs text-gray-400">{request.bio}</p>}<p className="text-sm bg-aura-elevated rounded-xl p-3 whitespace-pre-wrap break-words">{request.opening_message}</p><p className="text-[10px] text-gray-400">Accept to open an anonymous conversation. Identities stay hidden until mutual reveal.</p><div className="flex gap-3"><button className="aura-btn-secondary !py-2 text-xs" disabled={requestBusy===request.id} onClick={()=>handleRequest(request.id,'decline')}>Decline</button><button className="aura-btn-primary !py-2 text-xs" disabled={requestBusy===request.id} onClick={()=>handleRequest(request.id,'accept')}>Accept & chat</button></div></article>)}
        </section>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 px-8">
          <div className="empty-symbol"><Icon name="heart" size={28}/></div>
          <p className="text-gray-400">Your next connection is waiting.</p>
          <p className="text-gray-500 text-sm mt-1">Explore more Auras.</p>
        </div>
      ) : (
        <div>
          {filtered.map(m => (
            <ConversationPressable key={m.id} onOpen={()=>handleMatchClick(m)} onMenu={()=>setSelectedConversation(m)}>
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl relative" style={{ background: m.aura_color || 'linear-gradient(135deg,#a18baf,#b38d98)' }}>
                <Avatar src={m.profile_photo} name={m.aura_name || 'Aura'} size={48}/>
                {m.revealed && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-500 border-2 border-aura-deep flex items-center justify-center text-[8px]">✓</div>
                )}
                {!m.soul_game_completed && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-aura-violet border-2 border-aura-deep flex items-center justify-center text-[8px]"><Icon name="talk" size={10}/></div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-sm flex items-center gap-1">
                    {m.aura_name}
                    {m.pinned&&<Icon name="pin" size={12}/>}
                    {m.muted&&<Icon name="mute" size={12}/>}                    {m.revealed && <span className="text-green-400 text-[10px]">✓</span>}
                  </span>
                  <span className="text-[10px] text-gray-500">{formatTime(m.last_message_at || m.created_at)}</span>
                </div>
                {m.high_risk&&<p className="conversation-risk-label"><Icon name="warning" size={12}/>High risk · Only you</p>}
                {m.blocked_by_me&&<p className="text-xs text-red-600 mt-1">Blocked</p>}
                <div className="mt-1"><PresenceStatus presence={m} compact/></div>
                <div className="text-xs text-gray-400 mt-0.5 truncate">
                  {!m.soul_game_completed ? (
                    <span className="text-aura-violet-light">Start with a 5-minute Aura Farming</span>
                  ) : (
                    m.last_message || 'Start a conversation'
                  )}
                </div>
              </div>
              {!m.soul_game_completed ? (
                <Icon name="talk" size={14}/>
              ) : device.badges && m.unread > 0 ? (
                <div className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-aura-pink text-white text-[10px] font-bold flex items-center justify-center">{m.unread}</div>
              ) : null}
            </ConversationPressable>
          ))}
        </div>
      )}

      {selectedConversation&&<ConversationMenu conversation={selectedConversation} onClose={()=>setSelectedConversation(null)} onAction={async action=>{await api.post(`/matches/${selectedConversation.id}/manage`,{action});await fetchMatches();}}/>}
      <BottomNav />
    </div>
  );
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
