import MessageArrival from '../components/MessageArrival';
import useMessageArrivals from '../hooks/useMessageArrivals';
import TypingIndicator from '../components/TypingIndicator';
import useConversationSocket from '../hooks/useConversationSocket';
import ReportButton from '../components/ReportButton';
import { useDeviceSettings } from '../hooks/useDeviceSettings';
import { ConnectionCallButton } from '../components/ConnectionCallProvider';
import { ConnectionPlanCard, ConnectionPlanComposer } from '../components/ConnectionPlans';
import { formatCallDuration } from '../components/CallVisual';
import MessageReactions from '../components/MessageReactions';
import PresenceStatus from '../components/PresenceStatus';
import ChatAttachments from '../components/ChatAttachments';
import MessageMedia from '../components/MessageMedia';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import useChatScroll from '../hooks/useChatScroll';
import useConnectionPlans from '../hooks/useConnectionPlans';
import useMessageReceipts, { messageStatus } from '../hooks/useMessageReceipts';
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { isLoungeInvite } from '../loungeInvite';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

const ICEBREAKERS = [
  "What's your favorite way to unwind?",
  "If you could have any superpower, what would it be?",
  "What's a song that defines your mood right now?",
  "Coffee or tea? And why?",
  "What's the best thing that happened to you this week?",
];

function messagePreview(message) {
  if (!message || message.unsent_at) return 'Message unavailable';
  if (message.kind === 'image') return 'Photo';
  if (message.kind === 'audio') return 'Voice message';
  return message.content;
}

export default function Chat() {
  const [device]=useDeviceSettings();
  const { matchId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [highRisk,setHighRisk]=useState(false);
  const [presence,setPresence]=useState(null);
  const [messages, storeMessages] = useState([]);
  const messageRevision=useRef(0);
  const setMessages=update=>{messageRevision.current++;storeMessages(update);};
  const [input, setInput] = useState('');
  const [replyId, setReplyId] = useState(null);
  const [editId, setEditId] = useState(null);
  const [sending, setSending] = useState(false);
  const composer = useRef(null);
  const savedDraft = useRef('');
  const pendingText = useRef(null);
  const sendInProgress = useRef(false);
  const [match, setMatch] = useState(null);
  const [revealStatus, setRevealStatus] = useState('none');
  const [showIcebreaker, setShowIcebreaker] = useState(false);
  const [revealedIdentity, setRevealedIdentity] = useState(null);
  const [soulGameCompleted, setSoulGameCompleted] = useState(null);
  const [chatStatusError, setChatStatusError] = useState(false);
  const [sendError, setSendError] = useState('');
  const [historyLoaded,setHistoryLoaded]=useState(false);
  const applyEdit = edited => setMessages(previous => previous.map(message =>
    message.id === edited.id && !message.unsent_at &&
    (!message.edited_at || edited.edited_at >= message.edited_at) ? { ...message, ...edited } : message
  ));
  const arrivals=useMessageArrivals(messages,matchId,historyLoaded);
  const {partnerTyping,updateTyping,stopTyping}=useConversationSocket({kind:'match',id:matchId,myId:user?.user?.id,
    onMessage:msg=>setMessages(prev=>prev.some(m=>m.id===msg.id)?prev:[...prev,msg]),
    onUnsent:({messageId})=>setMessages(prev=>prev.map(m=>m.id===messageId?{...m,unsent_at:new Date().toISOString(),content:'',kind:'text',reactions:[]}:m)),
    onReactions:({messageId,reactions})=>setMessages(prev=>prev.map(m=>m.id===messageId?{...m,reactions}:m)),
    onEdited:applyEdit,
    onReveal:data=>{if(data.mutual)loadMatch();},onUnlocked:()=>setSoulGameCompleted(true)
  });
  const plans = useConnectionPlans(matchId, soulGameCompleted && revealStatus === 'mutual');
  const timeline = useMemo(() => {
    if (!plans.items?.length) return messages;
    const planEntries = plans.items.map(plan => ({ id: `plan-${plan.id}`, created_at: plan.created_at, plan }));
    return [...messages, ...planEntries].sort((left, right) => left.created_at.localeCompare(right.created_at));
  }, [messages, plans.items]);
  const { listRef, stickToBottom } = useChatScroll(timeline);

  useLayoutEffect(() => {
    const field = composer.current;
    if (!field) return;
    const resize = () => {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [input, soulGameCompleted, device.largeText]);

  const myId = user?.user?.id;
  useMessageReceipts(messages, `/matches/${matchId}/receipts`, myId);
  useEffect(() => {
    let active = true;
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      const revision=messageRevision.current;
      try {
        const [response,status] = await Promise.allSettled([api.get(`/matches/${matchId}/messages`, {timeout:8000}),api.get(`/matches/${matchId}/presence`, {timeout:5000})]);
        if (active && response.status === 'fulfilled') {
          if (revision === messageRevision.current) storeMessages(response.value.data);
          setHistoryLoaded(true);
        }
        if (active && status.status === 'fulfilled') setPresence(status.value.data);
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
    loadSoulGameStatus();
  }, [matchId]);

  const loadSoulGameStatus = async () => {
    setChatStatusError(false);
    try {
      // Get match details to check soul_game_completed
      const res = await api.get(`/matches/${matchId}/details`);
      const matchData = res.data;
      if (matchData) {
        setSoulGameCompleted(current => current === true || !!matchData.soul_game_completed);
        setHighRisk(!!matchData.high_risk);
      }
    } catch (err) {
      setChatStatusError(true);
      console.error(err);
    }
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

  const cancelEdit = () => {
    setEditId(null);
    setInput(savedDraft.current);
  };

  const startEdit = message => {
    if (!editId) savedDraft.current = input;
    setEditId(message.id);
    setInput(message.content);
    setShowIcebreaker(false);
    setSendError('');
    composer.current?.focus();
  };

  const sendMessage = async (text) => {
    if (!text.trim() || sendInProgress.current) return;
    sendInProgress.current = true;
    setSending(true);
    stopTyping();
    setSendError('');
    try {
      if (editId) {
        const { data } = await api.patch(`/matches/${matchId}/messages/${editId}`, { content: text });
        applyEdit(data);
        cancelEdit();
        return;
      }
      stickToBottom();
      if (pendingText.current?.text !== text || pendingText.current?.replyId !== replyId) {
        pendingText.current = { text, replyId, id: crypto.randomUUID() };
      }
      const res = await api.post(`/matches/${matchId}/messages`,
        { content: text, reply_to_id: replyId, client_message_id: pendingText.current.id }, { timeout: 20000 });
      pendingText.current = null;
      setMessages(prev => prev.some(message => message.id === res.data.id) ? prev : [...prev, res.data]);
      setInput('');
      setReplyId(null);
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'SOUL_GAME_REQUIRED') {
        setSoulGameCompleted(false);

      } else {
        setSendError(err.response?.data?.error || (editId ? 'Couldn’t save the edit. Try again.' : 'Couldn’t confirm the message. Try sending again.'));
      }
    } finally {
      sendInProgress.current = false;
      setSending(false);
    }
  };

  const sendAttachment = async attachment => {
    stickToBottom();
    const response=await api.post(`/matches/${matchId}/messages`,{...attachment,reply_to_id:replyId},{timeout:60000});
    setMessages(previous=>previous.some(message=>message.id===response.data.id)?previous:[...previous,response.data]);
    setReplyId(current => current === replyId ? null : current);
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
  const messagesById = new Map(messages.map(message => [message.id, message]));
  const nameFor = message => message && isMe(message) ? 'You' : revealedIdentity?.realName || 'Your Aura';

  if (soulGameCompleted === null || (!match && messages.length === 0)) {
    return (
      <div className="min-h-screen bg-aura-deep flex items-center justify-center text-gray-400">
        {chatStatusError ? <div className="text-center space-y-3">
          <p>Couldn’t load this conversation.</p>
          <button className="aura-btn-primary" onClick={loadSoulGameStatus}>Try again</button>
          <button className="block mx-auto" onClick={() => navigate('/matches')}>Back to Connections</button>
        </div> : 'Loading chat...'}
      </div>
    );
  }

  return (
    <div className={`chat-screen bg-aura-deep chat-wallpaper-${device.wallpaper} ${device.largeText?'chat-large-text':''}`}>
      {/* Header */}
      <div className="mobile-chat-bar flex items-center gap-3 px-4 py-3 bg-aura-bg border-b border-aura-border">
        <button onClick={() => navigate('/matches')} className="mobile-icon-action" aria-label="Back to Connections">←</button>
        <button disabled={revealStatus !== 'mutual'} onClick={() => navigate(`/profile/connection/${matchId}`)} aria-label="View connection profile" className="w-9 h-9 rounded-full bg-aura-elevated flex items-center justify-center text-lg"><Avatar src={revealedIdentity?.photo} name={revealedIdentity?.realName || 'Aura'} size={36}/></button>
        <button disabled={revealStatus !== 'mutual'} onClick={() => navigate(`/profile/connection/${matchId}`)} className="flex-1 text-left">
          <div className="text-sm font-bold flex items-center gap-1">
            {revealedIdentity?.realName || 'Aura Match'}
            {revealedIdentity && <span className="text-green-400 text-[10px]">✓ Revealed</span>}
          </div>
          <div className="text-[10px] text-gray-400"><PresenceStatus presence={presence}/><span>{presence?.active_now != null ? ' · ' : ''}{revealedIdentity ? 'View profile' : 'Identity hidden'}</span></div>
        </button>
        {soulGameCompleted && <ConnectionCallButton matchId={matchId} name={revealedIdentity?.realName || 'Aura Match'}/>}
        <ReportButton matchId={Number(matchId)} compact/>
      </div>

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
          <h2 className="text-xl font-extrabold mb-2">Start with an anonymous chat</h2>
          <p className="text-sm text-gray-400 mb-6">
            Spend five minutes with {revealedIdentity?.realName || 'this Aura'} in Meet to unlock direct messaging.
          </p>
          <button
            onClick={() => navigate(`/aura-chat/${matchId}`)}
            className="aura-btn-primary"
            style={{ background: 'linear-gradient(135deg,#897294,#b38d98)' }}
          >
            Open Meet
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
          {timeline.map(msg => {
            if (msg.plan) return <ConnectionPlanCard key={msg.id} plan={msg.plan} myId={myId}
              checkedAt={plans.checkedAt} onRespond={plans.respond}/>;
            const quoted = messagesById.get(msg.reply_to_id);
            return msg.kind === 'call' ? (
            <article key={msg.id} className="call-history-card">
              <span className="call-history-icon"><Icon name="phone" size={18}/></span>
              <div>
                <strong>{msg.content}</strong>
                <p>{isMe(msg) ? 'Outgoing' : 'Incoming'}{msg.duration_seconds != null && ` · ${formatCallDuration(msg.duration_seconds)}`}</p>
              </div>
              <time dateTime={msg.created_at}>{new Date(msg.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
            </article>
          ) : (
            <MessageArrival key={msg.id} id={`chat-message-${msg.id}`} mine={isMe(msg)} fresh={arrivals.has(msg.id)} className={`flex ${isMe(msg) ? 'justify-end' : 'justify-start'}`}>
              <MessageReactions message={msg} myId={myId} onReact={reactToMessage} onRemove={removeMessage}
                onReply={sending || editId ? undefined : message => {setReplyId(message.id);composer.current?.focus();}}
                onEdit={sending ? undefined : startEdit}
                className={`px-3.5 py-2.5 rounded-2xl text-sm ${isMe(msg) ? 'bg-gradient-to-br from-aura-violet to-aura-pink text-white rounded-br-md' : 'bg-aura-card-2 text-gray-200 rounded-bl-md'}`}>
                {msg.reply_to_id && !msg.unsent_at && <button type="button" className="chat-quote"
                  disabled={!quoted || !!quoted.unsent_at}
                  onClick={()=>document.getElementById(`chat-message-${msg.reply_to_id}`)?.scrollIntoView({block:'nearest'})}>
                  {quoted && !quoted.unsent_at && <strong>{nameFor(quoted)}</strong>}
                  <span>{messagePreview(quoted)}</span>
                </button>}
                {msg.unsent_at?<p className="italic opacity-70">This message was unsent</p>:msg.kind==='image'||msg.kind==='audio'?<MessageMedia message={msg} matchId={matchId}/>:null}
                {isLoungeInvite(msg.content) ? <Link to={msg.content} className="block underline font-semibold">Aura Lounge · Join to listen →</Link>
                  : msg.content && <p>{msg.content}</p>}
                {!msg.unsent_at && (isMe(msg) || msg.edited_at) && <p className="text-[10px] text-right mt-1 opacity-80">
                  {msg.edited_at && 'Edited'}{msg.edited_at && isMe(msg) && ' · '}{isMe(msg) && messageStatus(msg)}
                </p>}
              </MessageReactions>
            </MessageArrival>
          );})}
          <TypingIndicator visible={partnerTyping} name={revealedIdentity?.realName||'Your Aura'}/>
        </div>
      )}

      {/* Input */}
      {soulGameCompleted && (
        <div className="px-3 py-3 bg-aura-bg border-t border-aura-border pb-6">
          {!editId && <ChatAttachments key={matchId} onSend={sendAttachment}/>}
          {!editId && plans.items && <ConnectionPlanComposer onCreate={async values => {
            stickToBottom();
            await plans.create(values);
          }}/>}
          {(editId || replyId) && <div className="chat-composer-context">
            <div><strong>{editId ? 'Editing message' : `Replying to ${nameFor(messagesById.get(replyId))}`}</strong>
              <span>{messagePreview(messagesById.get(editId || replyId))}</span></div>
            <button type="button" disabled={sending} aria-label={editId ? 'Cancel edit' : 'Cancel reply'}
              onClick={editId ? cancelEdit : () => setReplyId(null)}>×</button>
          </div>}
          {showIcebreaker && !editId && (
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
          <div className="flex items-end gap-2">
            {!editId && <button onClick={() => setShowIcebreaker(!showIcebreaker)} className="w-10 h-10 shrink-0 rounded-xl bg-aura-card border border-aura-border flex items-center justify-center text-aura-violet-light">
              <Icon name={showIcebreaker ? 'talk' : 'spark'} size={18}/>
            </button>}
            <textarea
              ref={composer}
              rows={1}
              maxLength={5000}
              readOnly={sending}
              aria-label={editId ? 'Edit message' : 'Message'}
              className="aura-input chat-composer-input flex-1"
              value={input}
              onChange={e => {setInput(e.target.value);updateTyping(e.target.value);}}
              onBlur={stopTyping}
              onKeyDown={e => {
                if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || !device.enterToSend) return;
                e.preventDefault();
                sendMessage(input);
              }}
              placeholder="Type a message..."
            />
            <button
              disabled={sending || !input.trim()}
              aria-label={editId ? 'Save edited message' : 'Send message'}
              onClick={() => sendMessage(input)}
              className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-aura-violet to-aura-pink flex items-center justify-center disabled:opacity-40"
            >
              {editId ? '✓' : <Icon name="arrow" size={20}/>}
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


