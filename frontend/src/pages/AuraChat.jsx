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
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import BottomNav from '../components/BottomNav';

const POLL_MS = 3000;
function leaveSearch(sessionId) {
  const token = localStorage.getItem('aura_token');
  return fetch(`${api.defaults.baseURL}/aura-chat/${sessionId}/end`, {
    method: 'POST', keepalive: true,
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

export default function AuraChat() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const currentSession = useRef(null);
  const searchGeneration = useRef(0);
  const starting = useRef(false);

  const [mode,setMode]=useState('chat');
  const [filters,setFilters]=useState({ageMin:'',ageMax:'',gender:'',religion:''});
  const callStream=useRef(null);
  const stopMicrophone=()=>{callStream.current?.getTracks().forEach(t=>t.stop());callStream.current=null;};
  const [session, setSession] = useState(null);
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

  useMessageReceipts(messages, session?.sessionId ? `/aura-chat/${session.sessionId}/receipts` : null, user?.user?.id);

  useEffect(() => { currentSession.current = session; if(session?.status==='ended'||session?.status==='matched')stopMicrophone(); }, [session]);

  // Leaving the Aura Farming page cancels a pending search; tab switching does not.
  // The server lease also covers lost connections and abrupt browser closure.
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
    if (!session?.sessionId) return undefined;
    let cancelled = false;
    let polling = false;
    const id = session.sessionId;
    const tick = async () => {
      if (polling) return;
      polling = true;
      const generation = searchGeneration.current;
      try {
        const statusRes = currentSession.current?.status === 'waiting'
          ? await api.post(`/aura-chat/${id}/heartbeat`, {}, { timeout: 5000 })
          : await api.get(`/aura-chat/${id}/status`);
        if (cancelled || generation !== searchGeneration.current) return;
        if (statusRes.data.status === 'ended' && !statusRes.data.partner) {
          currentSession.current = null;
          setSession(null);
          setStatusMessage('Search expired. Tap below to look again.');
          return;
        }
        if (statusRes.data.status === 'active') setStatusMessage('');
        currentSession.current = statusRes.data;
        setSession(statusRes.data);
        if (statusRes.data.canChat) {
          const revision=messageRevision.current;
          const messagesRes = await api.get(`/aura-chat/${id}/messages`);
          if (!cancelled && generation === searchGeneration.current) {if(revision===messageRevision.current)storeMessages(messagesRes.data);setHistoryLoaded(true);}
        }
        if (statusRes.data.status === 'matched' && statusRes.data.matchId) {
          navigate(`/chat/${statusRes.data.matchId}`);
        }
      } catch (err) {
        if (!cancelled) setStatusMessage(err.response?.data?.error || 'Connection interrupted. Reconnecting…');
      } finally { polling = false; }
    };
    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [session?.sessionId, navigate]);

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

  const startSession = async () => {
    if (starting.current) return;
    starting.current = true;
    const generation = ++searchGeneration.current;
    setLoading(true);
    setStatusMessage('');
    setDecisionPending(false);
    try {
      const body = {mode:matchId?'chat':mode,filters:{...filters,ageMin:filters.ageMin===''?null:Number(filters.ageMin),ageMax:filters.ageMax===''?null:Number(filters.ageMax)}};
      if(!matchId&&mode==='call') {
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
      if (res.data.status === 'waiting') {
        setStatusMessage(matchId ? 'Waiting for this connection to start Aura Farming too…' : 'Waiting for someone who is also searching…');
      }
    } catch (err) {
      stopMicrophone();
      if (generation === searchGeneration.current) setStatusMessage(err.response?.data?.error || err.message || 'Unable to start Aura Farming.');
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
    setLoading(true);
    setStatusMessage('');
    try {
      const res = await api.post(`/aura-chat/${session.sessionId}/${earlyReveal ? 'reveal' : 'keep-talking'}`);
      if (res.data.matched) {
        if (res.data.matchId) {
          navigate(`/chat/${res.data.matchId}`);
        }
        return;
      }
      setDecisionPending(true);
      setStatusMessage('Waiting for the other Aura to decide...');
    } catch (err) {
      console.error(err);
      setStatusMessage(err.response?.data?.error || 'Failed to save your choice.');
    } finally {
      setLoading(false);
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
    setDecisionPending(false);
    setStatusMessage('');
    if (current?.sessionId) {
      try { await api.post(`/aura-chat/${current.sessionId}/end`); }
      catch { setStatusMessage('Connection interrupted. Your search will expire automatically.'); }
    }
  };

  const minutes = Math.floor((session?.secondsRemaining || 0) / 60);
  const seconds = (session?.secondsRemaining || 0) % 60;
  const timerLabel = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  if (!session && !matchId) return <div className="min-h-screen bg-aura-deep pb-24"><FarmingLobby mode={mode} setMode={setMode} filters={filters} setFilters={setFilters} onStart={startSession} loading={loading} statusMessage={statusMessage}/><BottomNav/></div>;
  if (!session) {
    return (
      <div className="min-h-screen bg-aura-deep flex flex-col items-center justify-center px-7 pb-24">
        <div className="w-28 h-28 rounded-full aura-orb mx-auto flex items-center justify-center mb-6">
          <div className="w-24 h-24 rounded-full bg-aura-deep flex items-center justify-center">
            <Icon name="talk" size={36}/>
          </div>
        </div>

        <h1 className="editorial-title text-center">
          {matchId ? 'Aura Farming' : 'A conversation, first.'}
        </h1>
        <p className="text-center text-gray-400 text-sm mt-3 px-4">
          {matchId
            ? 'Your conversation begins when you both start Aura Farming. You will have 5 minutes together.'
            : 'Meet someone who is also searching right now. Five minutes, just the two of you.'}
        </p>

        <div className="w-full mt-8 space-y-3">
          <button className="aura-btn-primary" onClick={startSession} disabled={loading}>
            {loading ? 'Starting...' : matchId ? 'Start a 5-minute conversation' : 'Meet someone new'}
          </button>
          <p className="text-center text-[11px] text-gray-500">
            {matchId
              ? 'No questions na. Straight anonymous conversation na agad.'
              : 'After 5 minutes, both of you can choose to keep talking and unfold if mutual.'}
          </p>
          {statusMessage && (
            <p className="text-center text-xs text-aura-gold">{statusMessage}</p>
          )}
        </div>

        <BottomNav />
      </div>
    );
  }

  if (session.status === 'waiting') {
    return (
      <div className="min-h-screen bg-aura-deep flex flex-col items-center justify-center px-7 pb-24 text-center">
        <div className="aura-finding-radar mb-7">
          <div className="aura-finding-ping" />
          <div className="aura-finding-ping delay-1" />
          <div className="aura-finding-ping delay-2" />
          <div className="aura-finding-ring" />
          <div className="aura-finding-ring ring-2" />
          <div className="aura-finding-ring ring-3" />
          <div className="aura-finding-dot dot-1" />
          <div className="aura-finding-dot dot-2" />
          <div className="aura-finding-dot dot-3" />
          <div className="aura-finding-core">
            <Icon name="talk" size={28}/>
          </div>
        </div>
        <h2 className="text-2xl font-extrabold">Finding an Aura...</h2>
        <p className="text-sm text-gray-400 mt-3 max-w-xs">
          Keep this screen open. You will only connect with someone who is actively searching too.
        </p>
        <div className="mt-4 text-xs text-aura-violet-light font-semibold inline-flex items-center gap-2">
          Waiting for a mutual search
          <span className="aura-finding-dots">
            <span />
            <span />
            <span />
          </span>
        </div>
        {statusMessage && <p className="text-xs text-aura-gold mt-4">{statusMessage}</p>}
        <button onClick={endChat} className="aura-btn-secondary mt-8">
          Cancel
        </button>
        <BottomNav />
      </div>
    );
  }

  const chatEnded = session.status === 'ended' || session.status === 'matched';

  return (
    <div className="chat-screen with-nav bg-aura-deep">
      <div className="flex items-center gap-3 px-4 py-3 bg-aura-bg border-b border-aura-border">
        <button onClick={() => navigate(matchId ? '/matches' : '/feed')} className="text-aura-violet-light">←</button>
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
          style={{ background: session.partner?.aura_color || 'linear-gradient(135deg,#a18baf,#b38d98)' }}
        >
          {session.partner?.aura_name?.charAt(0) || 'A'}
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold">{session.partner?.aura_name || 'Mystery Aura'}</div>
          <div className="text-[10px] text-gray-400">
            {chatEnded ? '5-minute talk finished' : 'Anonymous for 5 minutes'}
          </div>
        </div>
        <div className={`px-3 py-1 rounded-full text-xs font-bold ${chatEnded ? 'bg-aura-card text-aura-gold' : 'bg-aura-card text-aura-violet-light'}`}>
          {chatEnded ? 'Done' : timerLabel}
        </div><ReportButton sessionId={Number(session.sessionId)} compact/>
      </div>

      {!chatEnded && (
        <div className="mx-4 mt-4 aura-card p-3 text-center text-xs text-gray-300">
          After one minute, you can both choose to show your identity and keep talking without a timer.
        </div>
      )}

      {!chatEnded && (session.canReveal || session.secondsRemaining <= 240) && (
        <div className="mx-4 mt-3 aura-card p-3 space-y-2">
          <p className="text-xs text-gray-300 text-center">
            {session.partnerRevealRequested ? 'They are ready to show their identity. Are you?' : 'Ready to put a name to the conversation?'}
          </p>
          <button className="aura-btn-primary !py-3 text-sm" disabled={loading || decisionPending || session.revealRequested} onClick={() => keepTalking(true)}>
            {decisionPending || session.revealRequested ? 'Waiting for the other person…' : 'Show identity'}
          </button>
          <p className="text-[10px] text-gray-400 text-center">Both must agree. Then your identities appear and the timer is removed.</p>
        </div>
      )}

      {statusMessage && (
        <div className="mx-4 mt-3 p-3 rounded-xl text-center text-xs text-aura-gold" style={{ background: 'rgba(245,158,11,0.1)' }}>
          {statusMessage}
        </div>
      )}

      {session.mode==='call'&&!chatEnded?<RandomAudioCall session={session} stream={callStream.current} onEnd={endChat}/>:<div ref={listRef} className="chat-messages px-4 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 text-sm pt-10">
            {chatEnded ? 'Your 5-minute Aura Farming is complete.' : 'Say hi and start the vibe.'}
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
              placeholder="Type anonymously..."
            />
            <button
              onClick={sendMessage}
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
          {matchId ? (
            <div className="space-y-3">
              <button className="aura-btn-primary" onClick={unlockDirectMessages} disabled={loading}>
                {loading ? 'Unlocking...' : 'Unlock direct messages'}
              </button>
              <button className="aura-btn-secondary" onClick={() => navigate('/matches')}>
                Back to Matches
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <button className="aura-btn-primary" onClick={() => keepTalking(false)} disabled={loading || decisionPending}>
                {decisionPending ? 'Waiting for other Aura...' : 'Keep talking'}
              </button>
              <button className="aura-btn-secondary" onClick={endChat}>
                End Chat
              </button>
            </div>
          )}
        </div>
      ) : null}

      <BottomNav />
    </div>
  );
}
