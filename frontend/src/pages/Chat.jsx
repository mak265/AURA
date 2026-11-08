import ReportButton from '../components/ReportButton';
import { useDeviceSettings } from '../hooks/useDeviceSettings';
import MessageReactions from '../components/MessageReactions';
import PresenceStatus from '../components/PresenceStatus';
import ChatAttachments from '../components/ChatAttachments';
import MessageMedia from '../components/MessageMedia';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import useChatScroll from '../hooks/useChatScroll';
import useMessageReceipts, { messageStatus } from '../hooks/useMessageReceipts';
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

const ICEBREAKERS = [
  "What's your favorite way to unwind?",
  "If you could have any superpower, what would it be?",
  "What's a song that defines your mood right now?",
  "Coffee or tea? And why?",
  "What's the best thing that happened to you this week?",
];

export default function Chat() {
  const [device]=useDeviceSettings();
  const { matchId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [highRisk,setHighRisk]=useState(false);
  const [presence,setPresence]=useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [match, setMatch] = useState(null);
  const [revealStatus, setRevealStatus] = useState('none');
  const [showIcebreaker, setShowIcebreaker] = useState(false);
  const [revealedIdentity, setRevealedIdentity] = useState(null);
  const [soulGameCompleted, setSoulGameCompleted] = useState(false);
  const [sendError, setSendError] = useState('');
  const socketRef = useRef(null);
  const { listRef, stickToBottom } = useChatScroll(messages);

  const myId = user?.user?.id;
  useMessageReceipts(messages, `/matches/${matchId}/receipts`, myId);
  useEffect(() => {
    let active = true;
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const [response,status] = await Promise.all([api.get(`/matches/${matchId}/messages`),api.get(`/matches/${matchId}/presence`)]);
        if (active) {setMessages(response.data);setPresence(status.data);}
      } catch (error) { console.error(error); }
      finally { fetching = false; }
    };
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [matchId]);

  useEffect(() => {
    window.scrollTo(0, 0);
    loadMatch();
    connectSocket();
    loadSoulGameStatus();
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [matchId]);

  const loadSoulGameStatus = async () => {
    try {
      // Get match details to check soul_game_completed
      const res = await api.get(`/matches/${matchId}/details`);
      const matchData = res.data;
      if (matchData) {
        setSoulGameCompleted(!!matchData.soul_game_completed);
        setHighRisk(!!matchData.high_risk);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const connectSocket = () => {
    const token = localStorage.getItem('aura_token');
    const socket = io('http://localhost:5000', { auth: { token } });
    socketRef.current = socket;
    socket.emit('join:match', { matchId });
    socket.on('message', (msg) => {
      setMessages(prev => prev.some(message => message.id === msg.id) ? prev : [...prev, msg]);
    });
    socket.on('message:unsent', ({messageId}) => setMessages(previous=>previous.map(message=>message.id===messageId?{...message,unsent_at:new Date().toISOString(),content:'',kind:'text',reactions:[]}:message)));
    socket.on('message:reactions', ({messageId,reactions}) => setMessages(previous=>previous.map(message=>message.id===messageId?{...message,reactions}:message)));
    socket.on('reveal:update', (data) => {
      if (data.mutual) {
        loadMatch();
      }
    });
    socket.on('soul_game:completed', () => {
      setSoulGameCompleted(true);
    });
  };

  const loadMatch = async () => {
    try {
      const res = await api.get(`/matches/${matchId}/reveal/status`);
      setMatch(res.data);
      setRevealStatus(res.data.status);
      if (res.data.status === 'mutual') {
        setRevealedIdentity({ realName: res.data.real_name || 'Your connection', photo:res.data.profile_photo });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const sendMessage = async (text) => {
    if (!text.trim()) return;
    stickToBottom();
    setInput('');
    setSendError('');
    try {
      const res = await api.post(`/matches/${matchId}/messages`, { content: text });
      setMessages(prev => prev.some(message => message.id === res.data.id) ? prev : [...prev, res.data]);
    } catch (err) {
      const code = err.response?.data?.code;
      if(code==='TEXT_VIOLATION'||code==='TEXT_RESTRICTED')setInput(current=>current||text);
      if (code === 'SOUL_GAME_REQUIRED') {
        setSoulGameCompleted(false);

      } else {
        setSendError(err.response?.data?.error || 'Failed to send.');
      }
    }
  };

  const sendAttachment = async attachment => {
    stickToBottom();
    const response=await api.post(`/matches/${matchId}/messages`,attachment);
    setMessages(previous=>previous.some(message=>message.id===response.data.id)?previous:[...previous,response.data]);
  };
  const requestReveal = async () => {
    try {
      const res = await api.post(`/matches/${matchId}/reveal/request`);
      if (res.data.mutual) {
        setRevealStatus('mutual');
        loadMatch();
      } else {
        const statusRes = await api.get(`/matches/${matchId}/reveal/status`);
        setRevealStatus(statusRes.data.status);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const reactToMessage = async (messageId,reaction) => {
    const {data}=await api.post('/matches/'+matchId+'/messages/'+messageId+'/reaction',{reaction});
    setMessages(previous=>previous.map(message=>message.id===messageId?{...message,reactions:data.reactions}:message));
  };

  const removeMessage = async (messageId,action) => {
    await api.post('/matches/'+matchId+'/messages/'+messageId+'/remove',{action});
    setMessages(previous=>action==='delete_for_me'?previous.filter(message=>message.id!==messageId):previous.map(message=>message.id===messageId?{...message,unsent_at:new Date().toISOString(),content:'',kind:'text',reactions:[]}:message));
  };
  const isMe = (msg) => msg.sender_id === myId;

  if (!match && messages.length === 0) {
    return (
      <div className="min-h-screen bg-aura-deep flex items-center justify-center text-gray-400">
        Loading chat...
      </div>
    );
  }

  return (
    <div className={`chat-screen bg-aura-deep chat-wallpaper-${device.wallpaper} ${device.largeText?'chat-large-text':''}`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-aura-bg border-b border-aura-border">
        <button onClick={() => navigate('/matches')} className="text-aura-violet-light">←</button>
        <button disabled={revealStatus !== 'mutual'} onClick={() => navigate(`/profile/connection/${matchId}`)} aria-label="View connection profile" className="w-9 h-9 rounded-full bg-aura-elevated flex items-center justify-center text-lg"><Avatar src={revealedIdentity?.photo} name={revealedIdentity?.realName || 'Aura'} size={36}/></button>
        <button disabled={revealStatus !== 'mutual'} onClick={() => navigate(`/profile/connection/${matchId}`)} className="flex-1 text-left">
          <div className="text-sm font-bold flex items-center gap-1">
            {revealedIdentity?.realName || 'Aura Match'}
            {revealedIdentity && <span className="text-green-400 text-[10px]">✓ Revealed</span>}
          </div>
          <div className="text-[10px] text-gray-400"><PresenceStatus presence={presence}/><span>{presence?.active_now != null ? ' · ' : ''}{revealedIdentity ? 'View profile' : 'Identity hidden'}</span></div>
        </button>
     <ReportButton matchId={Number(matchId)} compact/></div>

      {highRisk&&<div className="chat-risk-warning"><Icon name="warning" size={17}/><p>Personal warning: you marked this conversation as high risk.</p></div>}
      {/* Reveal banner */}
      {revealStatus === 'requested_by_me' && (
        <div className="mx-4 mt-3 p-3 rounded-xl text-center text-xs text-gray-300" style={{ background: 'rgba(139,92,246,0.15)' }}>
          You've requested a reveal. Waiting for them to accept...
        </div>
      )}
      {revealStatus === 'requested_by_them' && (
        <div className="mx-4 mt-3 p-3 rounded-xl text-center text-xs" style={{ background: 'rgba(245,158,11,0.15)' }}>
          <p className="text-aura-gold font-semibold mb-1">They are ready to reveal identities.</p>
          <button onClick={requestReveal} className="px-4 py-1.5 rounded-lg text-white text-xs font-bold" style={{ background: 'linear-gradient(135deg,#897294,#b38d98)' }}>
            Accept Reveal
          </button>
        </div>
      )}
      {revealStatus === 'mutual' && (
        <div className="mx-4 mt-3 p-3 rounded-xl text-center text-xs text-green-400" style={{ background: 'rgba(34,197,94,0.1)' }}>
          You both chose to connect. Identities revealed.
        </div>
      )}

      {/* Soul Game Gate */}
      {!soulGameCompleted && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-24 h-24 rounded-full aura-orb flex items-center justify-center text-5xl mb-6 shadow-aura-glow">
            <Icon name="talk" size={36}/>
          </div>
          <h2 className="text-xl font-extrabold mb-2">Do the 5-Minute Aura Farming First</h2>
          <p className="text-sm text-gray-400 mb-6">
            Connect anonymously before you chat. Finish the 5-minute Aura Farming with {revealedIdentity?.realName || 'this aura'} to unlock direct messaging.
          </p>
          <button
            onClick={() => navigate(`/aura-chat/${matchId}`)}
            className="aura-btn-primary"
            style={{ background: 'linear-gradient(135deg,#897294,#b38d98)' }}
          >
            Start Aura Farming
          </button>

        </div>
      )}

      {/* Messages */}
      {soulGameCompleted && (
        <div ref={listRef} className="chat-messages px-4 py-4 space-y-3 pb-4">
          {revealStatus === 'none' && (
            <div className="aura-card p-4 text-center text-sm">
              You're chatting anonymously.
              <div className="text-xs text-gray-400 mt-1">Request a reveal when you're ready to share identities.</div>
            </div>
          )}
          {sendError && (
            <div className="p-3 rounded-xl text-center text-xs text-aura-gold" style={{ background: 'rgba(245,158,11,0.1)' }}>
              {sendError}
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${isMe(msg) ? 'justify-end' : 'justify-start'}`}>
              <MessageReactions message={msg} myId={myId} onReact={reactToMessage} onRemove={removeMessage} className={`px-3.5 py-2.5 rounded-2xl text-sm ${isMe(msg) ? 'bg-gradient-to-br from-aura-violet to-aura-pink text-white rounded-br-md' : 'bg-aura-card-2 text-gray-200 rounded-bl-md'}`}>
                {msg.unsent_at?<p className="italic opacity-70">This message was unsent</p>:msg.kind==='image'||msg.kind==='audio'?<MessageMedia message={msg} matchId={matchId}/>:null}
                {msg.content&&<p>{msg.content}</p>}
                {isMe(msg) && !msg.unsent_at && <p className="text-[10px] text-right mt-1 opacity-80">{messageStatus(msg)}</p>}
              </MessageReactions>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      {soulGameCompleted && (
        <div className="px-3 py-3 bg-aura-bg border-t border-aura-border pb-6">
          <ChatAttachments key={matchId} onSend={sendAttachment}/>
          {showIcebreaker && (
            <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
              {ICEBREAKERS.map((ib, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(ib)}
                  className="px-3 py-1.5 rounded-full text-[11px] bg-aura-card border border-aura-border text-gray-300 whitespace-nowrap flex-shrink-0"
                >
                  {ib}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setShowIcebreaker(!showIcebreaker)} className="w-10 h-10 rounded-xl bg-aura-card border border-aura-border flex items-center justify-center text-aura-violet-light">
              <Icon name={showIcebreaker ? 'talk' : 'spark'} size={18}/>
            </button>
            <input
              className="aura-input flex-1"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && device.enterToSend && sendMessage(input)}
              placeholder="Type a message..."
            />
            <button
              onClick={() => sendMessage(input)}
              className="w-10 h-10 rounded-xl bg-gradient-to-br from-aura-violet to-aura-pink flex items-center justify-center disabled:opacity-40"
            >
              <Icon name="arrow" size={20}/>
            </button>
          </div>
          {revealStatus === 'none' && (
            <button
              onClick={requestReveal}
              className="w-full mt-2 py-2 rounded-xl text-xs font-semibold text-aura-gold border border-aura-gold/40"
            >
              Request identity reveal
            </button>
          )}
        </div>
      )}
    </div>
  );
}


