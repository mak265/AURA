import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isLoungeInvite, loungeInvitePath } from '../loungeInvite';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Avatar from '../components/Avatar';
import ReportButton from '../components/ReportButton';
import ReactionIcon from '../components/ReactionIcon';
import Icon from '../components/Icon';
import { createLoungeAudio } from '../hooks/loungeAudio';
import useChatScroll from '../hooks/useChatScroll';
import './aura-lounge.css';

const loungeReactions = [
  { value: '👏', type: 'like', label: 'Like' },
  { value: '💜', type: 'love', label: 'Love' },
  { value: '😂', type: 'haha', label: 'Haha' },
];

function lobbyCode(id) {
  return id.replaceAll('-', '').slice(0, 8).toUpperCase();
}

export default function AuraLounge({ visible = true }) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [roomSearch, setRoomSearch] = useState('');
  const [room, setRoom] = useState(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [invitePreview, setInvitePreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const roomId = params.get('room');
  const validInvite = isLoungeInvite(loungeInvitePath(roomId));
  const invitedRoom = invitePreview?.id === roomId ? invitePreview.room : null;
  const query = roomSearch.trim().toLowerCase();
  const codeQuery = query.replace(/^#/, '');
  const matchingRooms = rooms.filter(item => !query ||
    (codeQuery && lobbyCode(item.id).toLowerCase().includes(codeQuery)) ||
    item.name.toLowerCase().includes(query) || item.host.toLowerCase().includes(query));
  const userId = user?.user?.id;

  useEffect(() => {
    if (!visible || room || creating || roomId) return;
    let current = true;
    const load = async () => {
      try {
        const { data } = await api.get('/lounge', { timeout: 5000 });
        if (current) {
          setRooms(data);
          setRoomsLoaded(true);
          setError(previous => previous === 'Couldn’t load live rooms. Retrying…' ? '' : previous);
        }
      } catch { if (current) setError('Couldn’t load live rooms. Retrying…'); }
    };
    load();
    const timer = setInterval(load, 6000);
    return () => { current = false; clearInterval(timer); };
  }, [room, creating, visible, roomId]);

  useEffect(() => {
    if (!visible || room || !validInvite) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const {data} = await api.get(`/lounge/${roomId}/preview`, { signal: controller.signal, timeout: 5000 });
        if (!controller.signal.aborted) setInvitePreview({id:roomId, room:data});
      } catch (err) {
        if (!controller.signal.aborted) setInvitePreview({id:roomId, room:null,
          unavailable:err.response?.status === 404});
      }
    };
    load();
    const timer = setInterval(load, 6000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [room, roomId, validInvite, visible]);

  const enter = async id => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const endpoint = id ? `/lounge/${id}/join` : '/lounge';
      const { data } = await api.post(endpoint, id ? {} : { name, topic, visibility }, { timeout: 8000 });
      setRoom(data);
      setCreating(false);
      if (roomId) setParams({}, { replace: true });
    } catch (err) { setError(err.response?.data?.error || 'Couldn’t enter the Lounge. Try again.'); }
    finally { setBusy(false); }
  };

  if (room) return <LoungeRoom key={room.id} initialRoom={room} userId={userId} visible={visible} onExit={message => {
    setRoom(null);
    setError(message || '');
  }}/>;
  if (!visible) return null;

  if (roomId && !creating) return <main className="lounge-page">
    <header className="lounge-header"><button type="button" aria-label="Back to Live Lounges" onClick={()=>{setParams({}, {replace:true});setError('');}}>←</button><h1>Lounge details</h1></header>
    <div className="lounge-body">
      {invitedRoom ? <article className="lounge-card">
        <h2>{invitedRoom.name}</h2>
        <p>Hosted by {invitedRoom.host}</p>
        {invitedRoom.topic && <p>{invitedRoom.topic}</p>}
        <button className="aura-btn-primary" disabled={busy || invitedRoom.full} onClick={()=>enter(invitedRoom.id)}>
          {invitedRoom.full ? 'Room full' : 'Join to listen'}
        </button>
      </article> : <p role="status">{!validInvite || (invitePreview?.id === roomId && invitePreview.unavailable)
        ? 'This Lounge has ended or is unavailable.' : invitePreview?.id === roomId
          ? 'Couldn’t check this room. Retrying…' : 'Checking room availability…'}</p>}
      {error && <p role="alert" className="lounge-error">{error}</p>}
    </div>
  </main>;

  if (creating) return <main className="lounge-page lounge-create">
    <header className="lounge-header">
      <button type="button" className="lounge-create-back" aria-label="Back to live rooms" disabled={busy}
        onClick={()=>{ setCreating(false); setError(''); }}>←</button>
      <h1>Create Lobby</h1>
    </header>
    <form className="lounge-create-form" onSubmit={event=>{ event.preventDefault(); enter(); }}>
      <div className="lounge-create-preview">
        <span className="lounge-create-icon"><Icon name="mic" size={25}/></span>
        <div><h2>{name.trim() || 'Your voice lounge'}</h2><p>{topic.trim() || 'Guests join with their mic off.'}</p></div>
      </div>
      <div className="lounge-create-fields">
        <label htmlFor="lounge-name">Room name</label>
        <input id="lounge-name" className="aura-input" placeholder="e.g. Late Night Tambay" required maxLength={48}
          disabled={busy} value={name} onChange={event=>setName(event.target.value)}/>
        <span className="lounge-create-count" aria-hidden="true">{name.length}/48</span>
        <label htmlFor="lounge-topic">Topic <span>Optional</span></label>
        <textarea id="lounge-topic" className="aura-input" placeholder="What are we talking about?" rows={3} maxLength={100}
          disabled={busy} value={topic} onChange={event=>setTopic(event.target.value)}/>
        <span className="lounge-create-count" aria-hidden="true">{topic.length}/100</span>
        <label htmlFor="lounge-visibility">Room visibility</label>
        <select id="lounge-visibility" className="aura-input" value={visibility} disabled={busy}
          onChange={event=>setVisibility(event.target.value)}>
          <option value="public">Public</option>
          <option value="unlisted">Link only</option>
        </select>
        <p className="lounge-visibility-help">{visibility === 'public'
          ? 'Appears in the public lobby list.'
          : 'People can join using the room link.'}</p>
      </div>
      {error && <p role="alert" className="lounge-error">{error}</p>}
      <div className="lounge-create-footer">
        <button className="aura-btn-primary" disabled={busy || !name.trim()}>{busy ? 'Opening lobby…' : 'Go live'}</button>
      </div>
    </form>
  </main>;

  return <main className="lounge-page lounge-directory">
    <header className="lounge-header"><Link to="/aura-chat" aria-label="Back to Meet">←</Link><h1>Live Lounges</h1></header>
    <div className="lounge-body">
      <div className="farming-intro lounge-directory-hero">
        <span className="farming-intro-orbit"><Icon name="mic" size={27}/></span>
        <div><h2>Find a room</h2><p>Join a live room to listen, or host your own.</p></div>
      </div>
      <div className="lounge-directory-actions">
        <button className="aura-btn-primary" disabled={busy} onClick={()=>{ setError(''); setVisibility('public'); setCreating(true); }}>Create Lobby</button>
      </div>
      <section aria-label="Public lounges" className="lounge-list">
        <header className="lounge-list-header">
          <h2 className="lounge-list-heading">Public lounges</h2>
          {roomsLoaded && rooms.length > 0 && <span>{rooms.length} live</span>}
        </header>
        <div className="lounge-room-search">
          <Icon name="discover" size={19}/>
          <input type="search" aria-label="Search public lobbies" placeholder="Search by name or lobby ID"
            value={roomSearch} onChange={event=>setRoomSearch(event.target.value)}/>
        </div>
        {rooms.length === 0 && <p role="status">{roomsLoaded ? 'No public lounges are live yet.' : 'Checking for live rooms…'}</p>}
        {rooms.length > 0 && matchingRooms.length === 0 && <p role="status">No public lobbies match your search.</p>}
        {matchingRooms.map(item=><article key={item.id} className="lounge-card lounge-directory-card">
          <div className="lounge-directory-room">
            <div className="lounge-room-art" aria-hidden="true"><Icon name="mic" size={21}/></div>
            <div><h3>{item.name}</h3>{item.topic && <p>{item.topic}</p>}
              <span className="lounge-code">Lobby ID <b>#{lobbyCode(item.id)}</b></span>
            </div>
          </div>
          <div className="lounge-directory-meta">
            <div><strong>{item.host}</strong><p>{item.speakers} speaking · {item.listeners} listening</p></div>
            <button type="button" className="lounge-directory-join" disabled={busy || item.full} onClick={()=>enter(item.id)}>
              {item.full ? 'Room full' : 'Join to listen'}{!item.full && <Icon name="arrow" size={14}/>}
            </button>
          </div>
        </article>)}
      </section>
      {error && <p role="alert" className="lounge-error">{error}</p>}
    </div>
  </main>;
}

function LoungeInvite({ roomId, onClose }) {
  const dialog = useRef(null);
  const retryKeys = useRef(new Map());
  const [matches, setMatches] = useState(null);
  const [sent, setSent] = useState({});
  const [sending, setSending] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    dialog.current.showModal();
    api.get('/matches', { signal: controller.signal, timeout: 8000 }).then(({data})=>{
      if (!controller.signal.aborted) setMatches(data.filter(match=>match.soul_game_completed && !match.blocked_by_me));
    }).catch(()=>{
      if (!controller.signal.aborted) setError('Couldn’t load your connections.');
    });
    return () => controller.abort();
  }, []);

  const send = async match => {
    if (sending || sent[match.id]) return;
    setSending(match.id);
    setError('');
    if (!retryKeys.current.has(match.id)) retryKeys.current.set(match.id, crypto.randomUUID());
    try {
      await api.post(`/matches/${match.id}/messages`, {
        content: loungeInvitePath(roomId), client_message_id: retryKeys.current.get(match.id),
      }, {timeout: 12000});
      setSent(previous=>({...previous, [match.id]:true}));
    } catch (err) {
      setError(err.response?.data?.error || 'Couldn’t confirm the invite. Try again.');
    } finally { setSending(null); }
  };

  return <dialog ref={dialog} className="lounge-invite lounge-share-sheet" aria-labelledby="lounge-share-title"
    onCancel={event=>{event.preventDefault();if(!sending)onClose();}}>
    <h2 id="lounge-share-title">Invite a connection</h2>
    <p>Send a link to this live room in your conversation.</p>
    <div className="lounge-share-list">
      {matches?.map(match=><div key={match.id}>
        <Avatar name={match.aura_name} src={match.profile_photo} size={36}/>
        <strong>{match.aura_name || 'Aura'}</strong>
        <button type="button" disabled={!!sending || sent[match.id]} onClick={()=>send(match)}>
          {sent[match.id] ? 'Sent' : sending === match.id ? 'Sending…' : 'Send invite'}
        </button>
      </div>)}
      {matches && matches.length === 0 && <p>No connections with an unlocked chat yet.</p>}
      {!matches && !error && <p role="status">Loading connections…</p>}
    </div>
    {error && <p role="alert">{error}</p>}
    <button className="aura-btn-secondary" disabled={!!sending} onClick={onClose}>Done</button>
  </dialog>;
}

function LoungeRoom({ initialRoom, userId, visible, onExit }) {
  const [room, setRoom] = useState(initialRoom);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [acceptedSeat, setAcceptedSeat] = useState(false);
  const [sent, setSent] = useState({});
  const [speaking, setSpeaking] = useState([]);
  const [muted, setMuted] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const audio = useRef(null);
  const mic = useRef(null);
  const active = useRef(false);
  const waiting = useRef(false);
  const exit = useRef(onExit);
  exit.current = onExit;
  const path = `/lounge/${room.id}`;
  const me = room.members?.find(member=>member.id === userId);
  const canManage = me?.host || me?.cohost;
  const commentsPaused = (me?.commentsPausedUntil || 0) > Date.now();
  const hasCohost = room.members?.some(member=>member.cohost);
  const seats = (room.members || []).filter(member => member.host || member.seated)
    .sort((a, b) => Number(b.host) - Number(a.host));
  const micInvite = visible && !confirmExit && me && !me.host && me.mic === 'approved' && !acceptedSeat;
  const selected = visible && !micInvite && room.members?.find(member=>member.id === selectedId);
  const raised = canManage ? (room.members || []).filter(member=>member.mic === 'requested' && member.id !== userId)
    .sort((a,b)=>a.requestedAt - b.requestedAt) : [];
  const invite = useRef(null);
  const actionsDialog = useRef(null);
  const exitDialog = useRef(null);
  useEffect(()=>{
    if (confirmExit && visible && !exitDialog.current.open) exitDialog.current.showModal();
  }, [confirmExit, visible]);
  useEffect(() => {
    const dialog = invite.current;
    if (micInvite && dialog && !dialog.open) dialog.showModal();
  }, [micInvite]);
  useEffect(() => {
    const dialog = actionsDialog.current;
    if (selected && dialog && !dialog.open) dialog.showModal();
  }, [selected]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let sampling = false;
    const timer = setInterval(async () => {
      if (sampling || !audio.current) return;
      sampling = true;
      try {
        const next = await audio.current.speakingUsers();
        if (active) setSpeaking(previous=>previous.join() === next.join() ? previous : next);
      } catch { if (active) setSpeaking(previous=>previous.length ? [] : previous); }
      finally { sampling = false; }
    }, 180);
    return () => { active = false; clearInterval(timer); };
  }, [visible]);
  const names = new Map(room.members?.map(member=>[member.id, member.name]));
  const { listRef, stickToBottom } = useChatScroll(room.messages || []);

  function stopMic() {
    mic.current?.getTracks().forEach(track=>track.stop());
    mic.current = null;
  }

  useEffect(() => {
    let alive = true;
    let polling = false;
    let interrupted = false;
    active.current = true;
    const connection = createLoungeAudio(initialRoom.id, userId, ()=>{ if (alive) setAudioBlocked(true); });
    audio.current = connection;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try {
        if (interrupted) {
          await api.post(`${path}/action`, { action: 'reconnect' }, { timeout: 5000 });
          if (!alive) return;
          connection.resetPeers();
          interrupted = false;
        }
        const { data } = await api.get(path, { params: { after: connection.cursor }, timeout: 5000 });
        if (!alive) return;
        setRoom(data);
        const myself = data.members.find(member=>member.id === userId);
        if (myself?.mic !== 'approved' && !waiting.current) setAcceptedSeat(false);
        if (!myself?.live && !waiting.current) stopMic();
        if (myself?.live && !waiting.current && !mic.current?.getAudioTracks().some(track=>track.readyState === 'live')) {
          stopMic();
          await api.post(`${path}/action`, { action: 'mute' }, { timeout: 5000 });
          if (!alive) return;
          myself.live = false;
          setError('Your microphone disconnected. Tap Mic on to speak again.');
        }
        await connection.update(data, mic.current);
        if (alive) setReconnecting(connection.needsAudioRecovery(data));
      } catch (err) {
        if (!alive) return;
        if ([403, 404].includes(err.response?.status)) {
          stopMic();
          connection.close();
          exit.current(err.response.data?.error || 'This Lounge ended.');
        } else {
          interrupted = true;
          setReconnecting(true);
        }
      } finally { polling = false; }
    };
    const leavePage = () => {
      stopMic();
      const token = localStorage.getItem('aura_token');
      if (token) fetch(`${api.defaults.baseURL}${path}/action`, {
        method: 'POST', keepalive: true, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'leave' }),
      }).catch(()=>{});
    };
    refresh();
    const timer = setInterval(refresh, 1400);
    window.addEventListener('pagehide', leavePage);
    return () => {
      alive = false;
      active.current = false;
      clearInterval(timer);
      window.removeEventListener('pagehide', leavePage);
      stopMic();
      connection.close();
    };
  }, [initialRoom.id, path, userId]);

  const act = async (action, values = {}) => {
    if (waiting.current) return false;
    waiting.current = true;
    setBusy(true);
    setError('');
    try {
      if (action === 'mic') {
        if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('Microphone access needs HTTPS or localhost.');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (!active.current) { stream.getTracks().forEach(track=>track.stop()); return false; }
        mic.current = stream;
      }
      if (['mute', 'listen'].includes(action)) stopMic();
      await api.post(`${path}/action`, { action, ...values }, { timeout: 6000 });
      if (action === 'mic') setAcceptedSeat(true);
      if (action === 'leave') { stopMic(); exit.current(); }
      return true;
    } catch (err) {
      if (action === 'mic') stopMic();
      setError(err.response?.data?.error || (err.name === 'NotAllowedError' ? 'Allow microphone access to speak.' : err.message));
      return false;
    } finally {
      waiting.current = false;
      setBusy(false);
    }
  };

  const sendAura = async member => {
    setSent(previous=>({...previous, [member.id]: 'Sending…'}));
    try {
      const { data } = await api.post(`/discover/${member.id}/send-aura`, {}, { timeout: 6000 });
      setSent(previous=>({...previous, [member.id]: data.matched ? 'Connected' : 'Aura sent'}));
    } catch (err) {
      setSent(previous=>({...previous, [member.id]: null}));
      setError(err.response?.data?.error || 'Couldn’t send Aura.');
    }
  };

  const participantActions = member => <div className="lounge-actions">
    <button disabled={!!sent[member.id]} onClick={()=>sendAura(member)}>{sent[member.id] || 'Send Aura'}</button>
    <button aria-pressed={!!muted[member.id]} onClick={()=>{
      const value = !muted[member.id];
      audio.current?.setMuted(member.id, value);
      setMuted(previous=>({...previous, [member.id]:value}));
    }}>{muted[member.id] ? 'Unmute for me' : 'Mute for me'}</button>
    <ReportButton userId={member.id}/>
    <button disabled={busy} onClick={async()=>{
      try { await api.post('/profile/block', {blockedId:member.id}, { timeout: 6000 }); setSelectedId(null); }
      catch { setError('Couldn’t block this user.'); }
    }}>Block</button>
    {me?.host && (!hasCohost || member.cohost) && <button disabled={busy}
      onClick={()=>act(member.cohost ? 'remove-cohost' : 'add-cohost', {target:member.id})}>{member.cohost ? 'Remove co-host role' : 'Make co-host'}</button>}
    {canManage && !member.host && (!member.cohost || me.host) && <>
      {member.mic === 'requested' && <button disabled={busy} onClick={()=>act('approve', {target:member.id})}>Approve mic</button>}
      {member.mic === 'approved' && <button disabled={busy} onClick={()=>act('demote', {target:member.id})}>Move to listeners</button>}
      <button disabled={busy} onClick={()=>act('remove', {target:member.id})}>Remove</button>
    </>}
    {canManage && !member.host && !member.cohost && <button disabled={busy} onClick={()=>act(
      member.commentsPausedUntil > Date.now() ? 'resume-comments' : 'pause-comments', {target: member.id}
    )}>{member.commentsPausedUntil > Date.now() ? 'Allow comments' : 'Pause comments · 5 min'}</button>}
  </div>;

  return <>
    {!visible && <aside className="lounge-floating" aria-label="Minimized Aura Lounge">
      <Link to="/aura-lounge">
        <Icon name="mic" size={19}/>
        <span><strong>{room.name}</strong><small>{reconnecting ? 'Reconnecting…' : me?.live ? 'Mic on' : 'Listening'} · Tap to return</small></span>
        <Icon name="arrow" size={18}/>
      </Link>
      {me?.live && <button type="button" disabled={busy} onClick={()=>act('mute')} aria-label="Mute microphone"><Icon name="mute" size={18}/></button>}
    </aside>}
    <main className="lounge-page lounge-live" hidden={!visible}>
    <header className="lounge-header">
      <Link to="/aura-chat" className="lounge-live-back" aria-label="Minimize room and go back">←</Link>
      <Avatar name={room.host} size={38}/>
      <div className="lounge-live-title"><h1>{room.name}</h1><p role="status">{reconnecting ? 'Reconnecting…' : `${room.host} · ${room.listeners} listening`}</p>
        <span className="lounge-code">Lobby ID <b>#{lobbyCode(room.id)}</b></span>
      </div>
      <button type="button" onClick={()=>setSharing(true)}>Invite</button>
      <button type="button" disabled={busy} onClick={()=>{setError('');setConfirmExit(true);}}>{me?.host ? 'End room' : 'Leave'}</button>
    </header>
    <div className="lounge-body">
      <div className="lounge-stage">
      {room.topic && <p className="lounge-live-topic">{room.topic}</p>}
      <section className="lounge-seat-grid" aria-label="Microphone seats">
        {Array.from({length:room.micSeats || 10}, (_, index)=>{
          const member = seats[index];
          return <div className="lounge-seat" key={index}>
            {member && member.id !== userId ? <button type="button"
              className={`lounge-seat-avatar ${member.live && speaking.includes(member.id) ? 'is-speaking' : ''}`}
              aria-label={`Actions for ${member.name}`} onClick={()=>{setError('');setSelectedId(member.id);}}>
              <Avatar name={member.name} size={49}/>
            </button> : <div className={`lounge-seat-avatar ${member?.live && speaking.includes(member.id) ? 'is-speaking' : ''}`}>
              {member ? <Avatar name={member.name} size={49}/> : <Icon name="mic" size={20}/>}
            </div>}
            <strong>{member?.name || 'Open seat'}</strong>
            <small>{member?.host ? 'Host' : member?.cohost ? 'Co-host' : member?.live ? 'Mic on' : member ? 'Mic off' : `Seat ${index + 1}`}</small>
          </div>;
        })}
      </section>
      <section className="lounge-card lounge-mic-control" aria-label="Microphone controls">
        <strong>{me?.live ? 'Your mic is on' : 'Listening · mic off'}</strong>
        {me?.mic === 'approved' ? <div className="lounge-actions">
          <button type="button" disabled={busy} className="lounge-mic-toggle"
            aria-label={me.live ? 'Mute microphone' : 'Turn on microphone'} aria-pressed={!!me.live}
            onClick={()=>act(me.live ? 'mute' : 'mic')}>
            <Icon name={me.live ? 'mic' : 'mute'} size={15}/>
            {me.live ? 'Mute' : 'Mic on'}
          </button>
          {!me.host && <button disabled={busy} onClick={()=>act('listen')}>Back to listening</button>}
        </div> : me?.mic === 'requested' ? <button disabled={busy} onClick={()=>act('listen')}>Cancel mic request</button>
          : <button disabled={!me || busy} className="aura-btn-secondary" onClick={()=>act('raise')}>Raise hand</button>}
        {audioBlocked && <button onClick={()=>audio.current?.resume().then(()=>setAudioBlocked(false)).catch(()=>setError('Couldn’t start audio.'))}>Enable room audio</button>}
      </section>
      {raised.length > 0 && <details className="lounge-card lounge-participants">
        <summary>Raised hands ({raised.length})</summary>
        {raised.map(member=><div className="lounge-raised-row" key={member.id}>
          <strong>{member.name}</strong>
          <div className="lounge-actions">
            <button disabled={busy} onClick={()=>act('approve', {target:member.id})}>Approve</button>
            <button disabled={busy} onClick={()=>act('skip', {target:member.id})}>Skip</button>
          </div>
        </div>)}
      </details>}
      <details className="lounge-card lounge-participants">
        <summary>In the room · {room.members?.length || 0}{canManage && room.members?.some(member=>member.mic==='requested') && ' · Hands raised'}</summary>
        {room.members?.map(member=><div className="lounge-member" key={member.id}>
          <div><Avatar name={member.name} size={32}/><span><strong>{member.name}</strong><small>{member.host ? 'Host' : member.cohost ? 'Co-host' : ''}{member.mic === 'requested' ? ' · Hand raised' : ''}{member.live ? ' · Mic on' : ''}</small></span></div>
          {member.id !== userId && <button type="button" onClick={()=>{setError('');setSelectedId(member.id);}}>Member actions</button>}
        </div>)}
      </details>
      </div>
      <section className="lounge-room-chat" aria-label="Live comments">
        <h2>Live comments</h2>
        {room.pinned && <div className="lounge-pinned">
          <Icon name="pin" size={16}/>
          <div><strong>Pinned · {names.get(room.pinned.user) || 'Aura'}</strong><p>{room.pinned.text}</p></div>
          {canManage && <button disabled={busy} onClick={()=>act('unpin')}>Unpin</button>}
        </div>}
        <div ref={listRef} className="lounge-messages" role="log" aria-label="Live comment feed" tabIndex={0}>
          {room.messages?.length ? room.messages.map(message=>{
            const mine = message.user === userId;
            const name = names.get(message.user) || 'Aura';
            const reaction = message.reaction && loungeReactions.find(option=>option.value === message.text);
            return <div className="lounge-chat-message" key={message.id}>
              <Avatar name={name} size={24}/>
              <p><strong>{mine ? 'You' : name}</strong> {reaction
                ? <span role="img" aria-label={reaction.label}><ReactionIcon type={reaction.type} size={20}/></span>
                : message.text}</p>
              {canManage && !message.reaction && <div className="lounge-comment-tools">
                {room.pinned?.id !== message.id && <button type="button" aria-label={`Pin comment by ${name}`}
                  className="lounge-comment-pin" disabled={busy} onClick={()=>act('pin', {target:message.id})}><Icon name="pin" size={14}/></button>}
                <button type="button" aria-label={`Hide comment by ${name}`} className="lounge-comment-pin"
                  disabled={busy} onClick={()=>act('hide-comment', {target:message.id})}><Icon name="trash" size={14}/></button>
              </div>}
            </div>;
          }) : <p className="lounge-chat-empty">Say hi to everyone in the room.</p>}
        </div>
        <div className="lounge-chat-composer">
        {error && <p role="alert" className="lounge-error">{error}</p>}
        {commentsPaused && <p role="status" className="lounge-error">A room admin paused your comments and reactions temporarily.</p>}
        <div className="lounge-actions" aria-label="Room reactions">
          {loungeReactions.map(({value, type, label}) =>
            <button type="button" key={type} aria-label={label} disabled={busy || commentsPaused} onClick={()=>act('react', {text:value})}>
              <ReactionIcon type={type} size={23}/>
            </button>
          )}
        </div>
        <form className="lounge-actions" onSubmit={async event=>{
          event.preventDefault();
          if (await act('message', {text})) {
            stickToBottom();
            setText('');
          }
        }}>
          <input className="aura-input" aria-label="Add a comment" placeholder="Add a comment…" maxLength={300} value={text} onChange={event=>setText(event.target.value)} disabled={busy || commentsPaused}/>
          <button type="submit" className="lounge-chat-send" aria-label="Post comment" disabled={!text.trim() || busy || commentsPaused}><Icon name="arrow" size={20}/></button>
        </form>
        </div>
      </section>
    </div>
    {confirmExit && visible && <dialog ref={exitDialog} className="lounge-invite" aria-labelledby="lounge-exit-title"
      onCancel={event=>{event.preventDefault();if (!busy) setConfirmExit(false);}}>
      <h2 id="lounge-exit-title">{me?.host ? 'End room for everyone?' : 'Leave this room?'}</h2>
      <p>{me?.host ? 'Everyone will be disconnected when you end the room.' : 'You’ll stop listening and leave the room.'}</p>
      {error && <p role="alert">{error}</p>}
      <button className="aura-btn-primary" disabled={busy} onClick={()=>act('leave')}>{me?.host ? 'End room' : 'Leave room'}</button>
      <button className="aura-btn-secondary" disabled={busy} onClick={()=>setConfirmExit(false)}>Stay in room</button>
    </dialog>}
    {sharing && visible && !micInvite && <LoungeInvite roomId={room.id} onClose={()=>setSharing(false)}/>}
    {selected && <dialog ref={actionsDialog} className="lounge-invite lounge-member-sheet" aria-labelledby="lounge-member-title"
      onCancel={event=>{event.preventDefault();setSelectedId(null);}}>
      <Avatar name={selected.name} size={46}/>
      <h2 id="lounge-member-title">{selected.name}</h2>
      {participantActions(selected)}
      {error && <p role="alert">{error}</p>}
      <button className="aura-btn-secondary" onClick={()=>setSelectedId(null)}>Done</button>
    </dialog>}
    {micInvite && <dialog ref={invite} className="lounge-invite" aria-labelledby="lounge-invite-title"
      onCancel={event=>{event.preventDefault();act('listen');}}>
        <span className="lounge-invite-avatar"><Avatar name={room.host} size={52}/></span>
        <h2 id="lounge-invite-title">You’re invited to speak</h2>
        <p>{room.host} approved your mic request in {room.name}.</p>
        {error && <p role="alert">{error}</p>}
        <button className="aura-btn-primary" disabled={busy} onClick={()=>act('mic')}>Join with mic</button>
        <button className="aura-btn-secondary" disabled={busy} onClick={()=>act('listen')}>Keep listening</button>
    </dialog>}
  </main></>;
}
