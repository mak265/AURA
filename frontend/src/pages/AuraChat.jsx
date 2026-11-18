import MessageArrival from '../components/MessageArrival';
import useMessageArrivals from '../hooks/useMessageArrivals';
import TypingIndicator from '../components/TypingIndicator';
import useConversationSocket from '../hooks/useConversationSocket';
import FarmingLobby from '../components/FarmingLobby';
import RandomAudioCall from '../components/RandomAudioCall';
import ReportButton from '../components/ReportButton';
import useChatScroll from '../hooks/useChatScroll';
import useMessageReceipts, { messageStatus } from '../hooks/useMessageReceipts';
import { useAuth } from '../context/AuthContext';
import Icon from '../components/Icon';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import Avatar from '../components/Avatar';
import './meet-session.css';

const POLL_MS = 3000;
const SEARCH_WAIT_HINT_MS = 20000;
function leaveSearch(sessionId) {
  const token = localStorage.getItem('aura_token');
  return fetch(`${api.defaults.baseURL}/aura-chat/${sessionId}/end`, {
    method: 'POST', keepalive: true,
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

export default function AuraChat({ visible = true }) {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const currentSession = useRef(null);
  const searchGeneration = useRef(0);
  const starting = useRef(false);

  const [mode,setMode]=useState('chat');
  const [filters,setFilters]=useState({ageMin:'',ageMax:'',gender:'',religion:'',workStatus:''});
  const callStream=useRef(null);
  const stopMicrophone=()=>{callStream.current?.getTracks().forEach(t=>t.stop());callStream.current=null;};
  const [session, setSession] = useState(null);
  const [joinedCall, setJoinedCall] = useState(null);
  const [messages, storeMessages] = useState([]);
  const messageRevision=useRef(0);
  const setMessages=update=>{messageRevision.current++;storeMessages(update);};
  const [historyLoaded,setHistoryLoaded]=useState(false);
  const arrivals=useMessageArrivals(messages,session?.sessionId,historyLoaded);
  const {partnerTyping,updateTyping,stopTyping}=useConversationSocket({kind:'aura',id:session?.sessionId,myId:user?.user?.id,enabled:session?.mode==='chat'&&session?.canChat});
  const { listRef, stickToBottom } = useChatScroll(messages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [decisionPending, setDecisionPending] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [searchTakingLonger, setSearchTakingLonger] = useState(false);
  const [revealedIdentity, setRevealedIdentity] = useState(null);
  const sessionId = session?.sessionId;
  const sessionMatched = session?.status === 'matched';

  useMessageReceipts(messages, sessionId && !sessionMatched ? `/aura-chat/${sessionId}/receipts` : null, user?.user?.id, visible);

  useEffect(() => { currentSession.current = session; if(session?.status==='ended'||session?.status==='matched')stopMicrophone(); }, [session]);

  // The app keeps this screen mounted across tabs. Close the search on page exit.
  useEffect(() => {
    const cancelPendingSearch = () => {
      searchGeneration.current += 1;
      setLoading(false);
      const current = currentSession.current;
      if (current?.status === 'waiting' || (current?.mode==='call' && current?.status==='active')) {
        leaveSearch(current.sessionId);
        stopMicrophone();
        currentSession.current = null;
        setSession(null);
        setStatusMessage('Search stopped. Start again when you are ready.');
      }
    };
    window.addEventListener('pagehide', cancelPendingSearch);
    return () => {
      searchGeneration.current += 1;
      const current = currentSession.current;
      if (current?.status === 'waiting' || (current?.mode==='call' && current?.status==='active')) leaveSearch(current.sessionId);
      stopMicrophone();
      currentSession.current = null;
      window.removeEventListener('pagehide', cancelPendingSearch);
    };
  }, []);

  useEffect(() => {
    if (!sessionId || sessionMatched) return undefined;
    let cancelled = false;
    let polling = false;
    const id = sessionId;
    const tick = async () => {
      if (polling) return;
      polling = true;
      const generation = searchGeneration.current;
      try {
        const statusRes = currentSession.current?.status === 'waiting'
          ? await api.post(`/aura-chat/${id}/heartbeat`, {}, { timeout: 5000 })
          : await api.get(`/aura-chat/${id}/status`, { timeout: 5000 });
        if (cancelled || generation !== searchGeneration.current) return;
        if (currentSession.current?.status === 'matched') return;
        setReconnecting(false);
        if (statusRes.data.status === 'ended' && !statusRes.data.partner) {
          currentSession.current = null;
          setSession(null);
          stopMicrophone();
          setStatusMessage('No match found before your search expired. Try again or adjust your filters.');
          return;
        }
        currentSession.current = statusRes.data;
        setSession(statusRes.data);
        if (statusRes.data.canChat) {
          const revision=messageRevision.current;
          const messagesRes = await api.get(`/aura-chat/${id}/messages`, { timeout: 5000 });
          if (!cancelled && generation === searchGeneration.current) {if(revision===messageRevision.current)storeMessages(messagesRes.data);setHistoryLoaded(true);}
        }
      } catch (err) {
        if (!cancelled && generation === searchGeneration.current) {
          if (err.response?.status === 404) {
            currentSession.current = null;
            setSession(null);
            setReconnecting(false);
            stopMicrophone();
            setStatusMessage('This session is no longer available. You can start a new search.');
          } else {
            setReconnecting(true);
          }
        }
      } finally { polling = false; }
    };
    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [sessionId, sessionMatched]);

  useEffect(() => {
    if (session?.status !== 'waiting') return;
    const timer = setTimeout(() => setSearchTakingLonger(true), SEARCH_WAIT_HINT_MS);
    return () => clearTimeout(timer);
  }, [session?.status, session?.sessionId]);

  const revealedMatchId = session?.status === 'matched' ? session.matchId : null;
  useEffect(() => {
    if (!visible || !revealedMatchId) return;
    const controller = new AbortController();
    api.get(`/matches/${revealedMatchId}/reveal/status`, { signal: controller.signal, timeout: 5000 })
      .then(({ data }) => {
        if (!controller.signal.aborted && data.status === 'mutual') setRevealedIdentity({ ...data, matchId: revealedMatchId });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [visible, revealedMatchId]);

  const openConnection = () => {
    if (!revealedMatchId) return;
    currentSession.current = null;
    setSession(null);
    setHistoryLoaded(false);
    navigate(`/chat/${revealedMatchId}`, { replace: true });
  };

  useEffect(() => {
    if (visible && session?.status === 'active' && session.mode === 'call') {
      setJoinedCall(session.sessionId);
    }
  }, [visible, session?.status, session?.mode, session?.sessionId]);

  useEffect(() => {
    if (!session?.status || session.status !== 'active' || session.secondsRemaining <= 0) {
      return undefined;
    }

    const timer = setInterval(() => {
      setSession(prev => {
        if (!prev || prev.status !== 'active') return prev;
        const nextSeconds = Math.max(0, (prev.secondsRemaining || 0) - 1);
        return {
          ...prev,
          secondsRemaining: nextSeconds,
          status: nextSeconds === 0 ? 'ended' : prev.status,
        };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [session?.status, session?.secondsRemaining]);

  const startSession = async (requestedMode) => {
    if (starting.current) return;
    starting.current = true;
    const generation = ++searchGeneration.current;
    setLoading(true);
    setStatusMessage('');
    setDecisionPending(false);
    setReconnecting(false);
    setSearchTakingLonger(false);
    setRevealedIdentity(null);
    setHistoryLoaded(false);
    const nextMode = matchId ? 'chat' : requestedMode === 'call' || requestedMode === 'chat' ? requestedMode : mode;
    setMode(nextMode);
    try {
      const body = {mode:nextMode,filters:{...filters,ageMin:filters.ageMin===''?null:Number(filters.ageMin),ageMax:filters.ageMax===''?null:Number(filters.ageMax)}};
      if(nextMode==='call') {
        if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection) throw new Error('Calls need a supported browser on HTTPS or localhost.');
        callStream.current=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
        if(generation!==searchGeneration.current){stopMicrophone();return;}
      }
      if (matchId) {
        const matchesRes = await api.get('/matches');
        const matchData = matchesRes.data.find(m => m.id === parseInt(matchId, 10));
        if (!matchData) throw new Error('This connection is no longer available.');
        body.partnerId = matchData.other_user_id;
      }
      if (generation !== searchGeneration.current) return;
      const res = await api.post('/aura-chat/start', body, { timeout: 10000 });
      if (generation !== searchGeneration.current) {
        await leaveSearch(res.data.sessionId);
        return;
      }
      currentSession.current = res.data;
      setSession(res.data);
      setMessages([]);
    } catch (err) {
      stopMicrophone();
      if (generation === searchGeneration.current) setStatusMessage(nextMode === 'call' && err.name === 'NotAllowedError'
        ? 'Allow microphone access to start a call.'
        : err.response?.data?.error || err.message || 'Unable to start searching.');
    } finally {
      starting.current = false;
      if (generation === searchGeneration.current) setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!session?.sessionId || !input.trim()) return;

    stickToBottom();
    stopTyping();
    const content = input;
    setInput('');
    try {
      const res = await api.post(`/aura-chat/${session.sessionId}/messages`, { content });
      setMessages(prev => [...prev, res.data]);
    } catch (err) {
      console.error(err);
      setStatusMessage(err.response?.data?.error || 'Failed to send message.');
    }
  };

  const keepTalking = async (earlyReveal = false) => {
    if (!session?.sessionId) return;
    const id = session.sessionId;
    setLoading(true);
    setStatusMessage('');
    try {
      const res = await api.post(`/aura-chat/${id}/${earlyReveal ? 'reveal' : 'keep-talking'}`);
      if (currentSession.current?.sessionId !== id) return;
      if (res.data.matched) {
        if (res.data.matchId) {
          const matched = { ...currentSession.current, status: 'matched', canChat: false, matchId: res.data.matchId };
          currentSession.current = matched;
          setReconnecting(false);
          setSession(matched);
        }
        return;
      }
      setDecisionPending(true);
    } catch (err) {
      console.error(err);
      if (currentSession.current?.sessionId === id) setStatusMessage(err.response?.data?.error || 'Failed to save your choice.');
    } finally {
      if (currentSession.current?.sessionId === id) setLoading(false);
    }
  };

  const unlockDirectMessages = async () => {
    if (!matchId) return;
    setLoading(true);
    try {
      await api.post(`/matches/${matchId}/soul-game/complete`);
      navigate(`/chat/${matchId}`);
    } catch (err) {
      console.error(err);
      setStatusMessage(err.response?.data?.error || 'Failed to unlock direct messages.');
    } finally {
      setLoading(false);
    }
  };

  const endChat = async () => {
    stopTyping();
    setHistoryLoaded(false);
    stopMicrophone();
    const current = currentSession.current;
    searchGeneration.current += 1;
    currentSession.current = null;
    setSession(null);
    setMessages([]);
    setInput('');
    setLoading(false);
    setDecisionPending(false);
    setReconnecting(false);
    setRevealedIdentity(null);
    setStatusMessage('');
    if (current?.sessionId) {
      try { await api.post(`/aura-chat/${current.sessionId}/end`); }
      catch { setStatusMessage('Connection interrupted. Your search will expire automatically.'); }
    }
  };

  const minutes = Math.floor((session?.secondsRemaining || 0) / 60);
  const seconds = (session?.secondsRemaining || 0) % 60;
  const timerLabel = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const backgroundNotice = !visible && session && createPortal(
    <aside className="aura-message-alert farming-background-notice" aria-label="Meet status">
      <button type="button" className="farming-background-open" onClick={() => navigate(matchId ? `/aura-chat/${matchId}` : '/aura-chat')}>
        <Icon name="talk" size={18}/>
        <span role="status">{session.status === 'waiting' ? 'Searching for a match…' :
          session.status === 'active' ? 'Match found · Return to Meet' :
          session.status === 'matched' ? 'Identities revealed · View reveal' : 'Conversation finished · View session'}</span>
      </button>
      <button type="button" onClick={endChat}>{session.status === 'waiting' ? 'Cancel' : session.status === 'active' ? 'End' : 'Dismiss'}</button>
    </aside>, document.body);

  if (!session && !matchId) return <div className="mobile-tab-screen bg-aura-deep"><FarmingLobby visible={visible} mode={mode} filters={filters} setFilters={setFilters} onStart={startSession} loading={loading} statusMessage={statusMessage}/></div>;
  if (!session) {
    return (
      <div className="min-h-screen bg-aura-deep flex flex-col items-center justify-center px-7 pb-24">
        <div className="w-28 h-28 rounded-full aura-orb mx-auto flex items-center justify-center mb-6">
          <div className="w-24 h-24 rounded-full bg-aura-deep flex items-center justify-center">
            <Icon name="talk" size={36}/>
          </div>
        </div>

        <h1 className="editorial-title text-center">
          Start an anonymous chat
        </h1>
        <p className="text-center text-gray-400 text-sm mt-3 px-4">
          The five-minute chat starts when both of you are ready.
        </p>

        <div className="w-full mt-8 space-y-3">
          <button className="aura-btn-primary" onClick={startSession} disabled={loading}>
            {loading ? 'Starting…' : 'Start a 5-minute chat'}
          </button>
          <p className="text-center text-[11px] text-gray-500">
            You can reveal your identities if you both agree.
          </p>
          {statusMessage && (
            <p className="text-center text-xs text-aura-gold">{statusMessage}</p>
          )}
        </div>

      </div>
    );
  }

  if (session.status === 'waiting') {
    return (
      <>{backgroundNotice}<div className="meet-search bg-aura-deep">
        <div className="meet-search-motion" aria-hidden="true">
          <span className="meet-search-bubble"><Icon name={session.mode === 'call' ? 'mic' : 'talk'} size={27}/></span>
          <span className="meet-search-signal"><i/><i/><i/></span>
          <span className="meet-search-bubble"><Icon name={session.mode === 'call' ? 'phone' : 'talk'} size={27}/></span>
        </div>
        <h1>{session.mode === 'call' ? 'Finding a call' : 'Finding a chat'}</h1>
        <p role="status">{reconnecting ? 'Connection interrupted. Reconnecting to your search…' : searchTakingLonger
          ? 'Still looking for someone who matches your filters. You can keep browsing while you wait.'
          : matchId ? 'Waiting for your connection to start the chat too.'
          : 'We’re looking for someone who is also searching. You can keep browsing AURA.'}</p>
        <button onClick={endChat} className="aura-btn-secondary">Cancel search</button>
      </div></>
    );
  }

  const chatEnded = session.status === 'ended' || session.status === 'matched';
  const identity = revealedIdentity?.matchId === revealedMatchId ? revealedIdentity : null;
  const revealPending = decisionPending || session.revealRequested;

  return (
    <>{backgroundNotice}<div className="chat-screen bg-aura-deep meet-conversation">
      <div className="meet-conversation-header">
        <button onClick={() => navigate(matchId ? '/matches' : '/feed')} aria-label="Back to AURA" className="meet-conversation-back">←</button>
        {revealedMatchId ? <Avatar src={identity?.profile_photo} name={identity?.real_name || 'Connection'}/>
          : <span className="meet-anonymous-icon"><Icon name="profile" size={21}/></span>}
        <div className="meet-conversation-person">
          <strong>{identity?.real_name || session.partner?.aura_name || 'Your Aura'}</strong>
          <span><Icon name={revealedMatchId ? 'heart' : 'lock'} size={13}/>{revealedMatchId ? 'Identity revealed' : 'Identity hidden'}</span>
        </div>
        {!revealedMatchId && <span className="meet-timer">{chatEnded ? 'Ended' : timerLabel}</span>}
        <ReportButton sessionId={Number(session.sessionId)} compact/>
      </div>

      {revealedMatchId ? <div className="meet-reveal-panel meet-reveal-complete" role="status">
        <Icon name="spark" size={25}/>
        <div><strong>{identity?.real_name ? `You connected with ${identity.real_name}` : 'You both chose to reveal'}</strong>
          <p>Your messages are saved in Connections. You can keep talking without a timer.</p></div>
      </div> : !chatEnded && <div className="meet-reveal-panel">
        <Icon name="heart" size={19}/>
        <div><strong>{revealPending ? 'Waiting for their choice' : session.partnerRevealRequested ? 'They’re ready to reveal' : 'Reveal together'}</strong>
          <p>{revealPending ? 'Your identity stays hidden until they agree.' : session.canReveal || session.secondsRemaining <= 240
            ? 'You can keep talking without a timer if you both agree.' : 'Available after one minute. Both people must agree.'}</p></div>
        {!revealPending && (session.canReveal || session.secondsRemaining <= 240) &&
          <button className="aura-btn-primary" disabled={loading} onClick={() => keepTalking(true)}>Reveal together</button>}
      </div>}

      {reconnecting && !revealedMatchId && <p className="meet-connection-status" role="status">Connection interrupted. Reconnecting…</p>}

      {statusMessage && (
        <div className="mx-4 mt-3 p-3 rounded-xl text-center text-xs text-aura-gold" style={{ background: 'rgba(245,158,11,0.1)' }}>
          {statusMessage}
        </div>
      )}

      {session.mode==='call'&&!chatEnded ? (visible || joinedCall === session.sessionId) &&
        <RandomAudioCall session={session} stream={callStream.current} onEnd={endChat}/> : <div ref={listRef} className="chat-messages px-4 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 text-sm pt-10">
            {chatEnded ? 'Your five-minute conversation is complete.' : 'Say hi when you’re ready.'}
          </div>
        ) : (
          messages.map(msg => (
            <MessageArrival key={msg.id} mine={msg.sender_id===user?.user?.id} fresh={arrivals.has(msg.id)} className={`flex ${msg.sender_id === session.partner?.id ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm ${msg.sender_id === session.partner?.id ? 'bg-aura-card-2 text-gray-200 rounded-bl-md' : 'bg-gradient-to-br from-aura-violet to-aura-pink text-white rounded-br-md'}`}>
                <p>{msg.content}</p>
                {msg.sender_id === user?.user?.id && <p className="text-[10px] text-right mt-1 opacity-80">{messageStatus(msg)}</p>}
              </div>
            </MessageArrival>
          ))
        )}
        <TypingIndicator visible={partnerTyping} name={session.partner?.aura_name||'Your Aura'}/>
      </div>}

      {!chatEnded && session.mode!=='call' ? (
        <div className="px-3 py-3 bg-aura-bg border-t border-aura-border pb-6">
          <div className="flex gap-2">
            <input
              className="aura-input flex-1"
              value={input}
              onChange={e => {setInput(e.target.value);updateTyping(e.target.value);}}
              onBlur={stopTyping}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              aria-label="Anonymous message"
              placeholder="Write a message…"
            />
            <button
              onClick={sendMessage}
              aria-label="Send message"
              disabled={!input.trim()}
              className="w-10 h-10 rounded-xl bg-gradient-to-br from-aura-violet to-aura-pink flex items-center justify-center"
            >
              <Icon name="arrow" size={20}/>
            </button>
          </div>
          <button onClick={endChat} className="text-gray-500 text-xs text-center mt-3 w-full">
            End Chat
          </button>
        </div>
      ) : chatEnded ? (
        <div className="px-4 pt-2">
          {revealedMatchId ? <button className="aura-btn-primary meet-continue" onClick={openConnection}>Continue conversation <Icon name="arrow" size={17}/></button> : matchId ? (
            <div className="space-y-3">
              <button className="aura-btn-primary" onClick={unlockDirectMessages} disabled={loading}>
                {loading ? 'Unlocking...' : 'Unlock direct messages'}
              </button>
              <button className="aura-btn-secondary" onClick={() => navigate('/matches')}>
                Back to Connections
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <button className="aura-btn-primary" onClick={() => keepTalking(false)} disabled={loading || revealPending}>
                {revealPending ? 'Waiting for their choice…' : 'Reveal and keep talking'}
              </button>
              <button className="aura-btn-secondary" onClick={endChat}>
                End Chat
              </button>
            </div>
          )}
        </div>
      ) : null}

    </div></>
  );
}
