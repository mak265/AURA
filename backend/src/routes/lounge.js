const router = require('express').Router();
const { randomUUID } = require('node:crypto');
const { authenticate } = require('../middleware/auth');
const { enforceText } = require('../textModeration');
const { profileVisibleSql } = require('../profileVisibility');
const db = require('../db');

// Live rooms belong to this server process. Audio always travels over WebRTC.
const rooms = new Map();
const LEASE = 45000;
const MIC_SEATS = 10;
const REGULAR_LIMIT = 10;
const online = member => member && Date.now() - member.seen < LEASE;
const isAdmin = (room, user) => user === room.host || user === room.cohost;
const regularCount = room => [...room.members.keys()].filter(user => !isAdmin(room, user)).length;

function prune() {
  for (const [id, room] of rooms) {
    if (!online(room.members.get(room.host))) {
      rooms.delete(id);
      continue;
    }
    for (const [user, member] of room.members) if (!online(member)) room.members.delete(user);
    if (!room.members.has(room.cohost)) room.cohost = null;
    room.signals = room.signals.filter(signal => Date.now() - signal.at < LEASE);
  }
}

function summary(room) {
  const speakers = [...room.members.values()].filter(member => member.live).length;
  return { id: room.id, name: room.name, topic: room.topic, host: room.hostName,
    speakers, listeners: room.members.size - speakers, capacity: REGULAR_LIMIT + 2, micSeats: MIC_SEATS,
    visibility: room.visibility || 'public', full: regularCount(room) >= REGULAR_LIMIT };
}

async function visibleUsers(ids, viewer) {
  const { rows } = await db.query(`SELECT a.user_id, a.aura_name FROM auras a
    WHERE a.user_id=ANY($1::int[]) AND ${profileVisibleSql('a.user_id', '$2')}`, [ids, viewer]);
  return rows;
}

router.use(authenticate, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  prune();
  next();
});

async function publicRooms(user) {
  const list = [...rooms.values()].filter(room => room.visibility !== 'unlisted' && !room.removed.has(user));
  const profiles = await visibleUsers(list.map(room => room.host), user);
  const visible = new Set(profiles.map(profile => profile.user_id));
  return list.filter(room => visible.has(room.host) && rooms.has(room.id));
}

function currentRoom(user) {
  return [...rooms.values()].find(room => room.members.has(user));
}

function addListener(room, user) {
  room.members.set(user, { seen: Date.now(), mic: 'listener', live: false });
}

router.get('/', async (req, res, next) => {
  try {
    res.json((await publicRooms(req.user.userId)).map(summary).sort((a, b) =>
      Number(a.full) - Number(b.full) || b.speakers - a.speakers || b.listeners - a.listeners));
  } catch (error) { next(error); }
});

router.post('/random', async (req, res, next) => {
  const user = req.user.userId;
  try {
    if (!(await visibleUsers([user], user)).length) return res.status(403).json({ error: 'Set up your Aura profile first.' });
    const list = await publicRooms(user);
    if (currentRoom(user)) return res.status(409).json({ error: 'Leave your current Lounge first.' });
    const available = list.filter(room => rooms.has(room.id) && !room.removed.has(user) && regularCount(room) < REGULAR_LIMIT);
    if (!available.length) return res.status(404).json({ error: 'No public Lounge has an open spot right now.' });
    const room = available[Math.floor(Math.random() * available.length)];
    addListener(room, user);
    res.json(summary(room));
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  const user = req.user.userId;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const topic = typeof req.body.topic === 'string' ? req.body.topic.trim() : '';
  const { visibility = 'public' } = req.body;
  if (!['public', 'unlisted'].includes(visibility)) return res.status(400).json({ error: 'Choose Public or Link only.' });
  if (!name || name.length > 48 || topic.length > 100) return res.status(400).json({ error: 'Enter a room name and a topic of up to 100 characters.' });
  try {
    const [profile] = await visibleUsers([user], user);
    if (!profile) return res.status(403).json({ error: 'Set up your Aura profile first.' });
    if (!await enforceText(req, res, `${name} ${topic}`)) return;
    if (currentRoom(user)) return res.status(409).json({ error: 'Leave your current Lounge first.' });
    if (rooms.size >= 50) return res.status(503).json({ error: 'All Lounge slots are in use. Try again later.' });
    const room = { id: randomUUID(), name, topic, visibility, host: user, hostName: profile.aura_name,
      members: new Map([[user, { seen: Date.now(), mic: 'approved', live: false }]]),
      removed: new Set(), commentPauses: new Map(), messages: [], signals: [], cursor: 0 };
    rooms.set(room.id, room);
    res.status(201).json(summary(room));
  } catch (error) { next(error); }
});

router.param('roomId', (req, res, next, id) => {
  req.room = rooms.get(id);
  if (!req.room) return res.status(404).json({ error: 'This Lounge has ended.' });
  next();
});

router.get('/:roomId/preview', async (req, res, next) => {
  const user = req.user.userId;
  const room = req.room;
  try {
    const visible = await visibleUsers([room.host], user);
    if (!visible.length || room.removed.has(user) || !rooms.has(room.id)) {
      return res.status(404).json({ error: 'This Lounge is unavailable.' });
    }
    res.json(summary(room));
  } catch (error) { next(error); }
});

router.post('/:roomId/join', async (req, res, next) => {
  const room = req.room;
  const user = req.user.userId;
  try {
    const visible = await visibleUsers([room.host, user], user);
    if (room.removed.has(user) || !visible.some(profile => profile.user_id === room.host) ||
        !visible.some(profile => profile.user_id === user) || !rooms.has(room.id)) {
      return res.status(404).json({ error: 'This Lounge is unavailable.' });
    }
    if (room.members.has(user)) {
      const member = room.members.get(user);
      member.live = false;
      member.seen = Date.now();
      return res.json(summary(room));
    }
    if (currentRoom(user)) return res.status(409).json({ error: 'Leave your current Lounge first.' });
    if (regularCount(room) >= REGULAR_LIMIT) return res.status(409).json({ error: 'All regular member spots are filled.' });
    addListener(room, user);
    res.json(summary(room));
  } catch (error) { next(error); }
});

router.use('/:roomId', (req, res, next) => {
  const member = req.room.members.get(req.user.userId);
  if (!member) return res.status(403).json({ error: 'You’re no longer in this Lounge.' });
  req.member = member;
  member.seen = Date.now();
  next();
});

router.get('/:roomId', async (req, res, next) => {
  const room = req.room;
  const user = req.user.userId;
  try {
    const profiles = await visibleUsers([...room.members.keys()], user);
    if (!profiles.some(profile => profile.user_id === room.host) ||
        !rooms.has(room.id) || !room.members.has(user)) {
      room.members.delete(user);
      return res.status(403).json({ error: 'This Lounge is unavailable.' });
    }
    const members = profiles.filter(profile => room.members.has(profile.user_id)).map(profile => {
      const { mic, live, requestedAt } = room.members.get(profile.user_id);
      return { id: profile.user_id, name: profile.aura_name, live, seated: mic === 'approved', host: profile.user_id === room.host,
        cohost: profile.user_id === room.cohost,
        audioVersion: room.members.get(profile.user_id).audioVersion || 0,
        commentsPausedUntil: isAdmin(room, user) || user === profile.user_id
          ? room.commentPauses.get(profile.user_id) || null : undefined,
        requestedAt: isAdmin(room, user) && mic === 'requested' ? requestedAt : undefined,
        mic: isAdmin(room, user) || user === profile.user_id ? mic : undefined };
    });
    const visible = new Set(members.map(member => member.id));
    res.json({ ...summary(room), members, messages: room.messages.filter(message => visible.has(message.user)),
      pinned: visible.has(room.pinned?.user) ? room.pinned : null,
      signals: room.signals.filter(signal => signal.to === user && visible.has(signal.from) && signal.id > Number(req.query.after || 0)) });
  } catch (error) { next(error); }
});

router.post('/:roomId/action', async (req, res, next) => {
  const room = req.room;
  const user = req.user.userId;
  const { action, target, text } = req.body;
  const member = req.member;
  try {
    switch (action) {
      case 'leave':
        if (user === room.host) rooms.delete(room.id);
        else {
          room.members.delete(user);
          if (user === room.cohost) room.cohost = null;
        }
        break;
      case 'raise':
        if (member.mic === 'listener') {
          member.mic = 'requested';
          member.requestedAt = Date.now();
        }
        break;
      case 'listen':
        member.live = false;
        member.mic = user === room.host ? 'approved' : 'listener';
        break;
      case 'mic':
        if (member.mic !== 'approved') return res.status(403).json({ error: 'Ask the host for a mic slot first.' });
        member.live = true;
        break;
      case 'mute':
        member.live = false;
        break;
      case 'reconnect':
        member.audioVersion = (member.audioVersion || 0) + 1;
        break;
      case 'hide-comment':
        if (!isAdmin(room, user)) return res.status(403).json({ error: 'Only room admins can hide comments.' });
        room.messages = room.messages.filter(message => message.id !== target || message.reaction);
        if (room.pinned?.id === target) room.pinned = null;
        break;
      case 'pause-comments':
      case 'resume-comments':
        if (!isAdmin(room, user) || isAdmin(room, target) || !room.members.has(target)) {
          return res.status(403).json({ error: 'Only room admins can manage guest comments.' });
        }
        if (action === 'pause-comments') room.commentPauses.set(target, Date.now() + 5 * 60 * 1000);
        else room.commentPauses.delete(target);
        break;
      case 'pin':
      case 'unpin': {
        if (!isAdmin(room, user)) return res.status(403).json({ error: 'Only room admins can pin comments.' });
        if (action === 'unpin') {
          room.pinned = null;
          break;
        }
        const comment = room.messages.find(message => message.id === target && !message.reaction);
        if (!comment || !(await visibleUsers([comment.user], user)).length) {
          return res.status(404).json({ error: 'This comment is unavailable.' });
        }
        if (!rooms.has(room.id) || room.members.get(user) !== member || !isAdmin(room, user)) {
          return res.status(403).json({ error: 'Only room admins can pin comments.' });
        }
        if (!room.messages.includes(comment)) return res.status(404).json({ error: 'This comment is unavailable.' });
        room.pinned = comment;
        break;
      }
      case 'add-cohost':
      case 'remove-cohost':
        if (user !== room.host || target === user || !room.members.has(target)) {
          return res.status(403).json({ error: 'Only the host can change the co-host.' });
        }
        if (action === 'add-cohost') {
          if (room.cohost) return res.status(409).json({ error: 'This Lounge already has a co-host.' });
          room.cohost = target;
        } else {
          if (room.cohost !== target || regularCount(room) >= REGULAR_LIMIT) {
            return res.status(409).json({ error: 'Free a regular member spot before removing the co-host role.' });
          }
          room.cohost = null;
        }
        break;
      case 'approve':
      case 'skip':
      case 'demote':
      case 'remove': {
        const guest = room.members.get(target);
        if (!isAdmin(room, user) || !guest || target === user || target === room.host ||
            (isAdmin(room, target) && user !== room.host)) {
          return res.status(403).json({ error: 'Only room admins can manage guests.' });
        }
        if (action === 'approve') {
          if (guest.mic !== 'requested' || [...room.members.values()].filter(person => person.mic === 'approved').length >= MIC_SEATS) {
            return res.status(409).json({ error: 'A requested hand and an open mic slot are required.' });
          }
          guest.mic = 'approved';
        } else if (action === 'skip') {
          if (guest.mic !== 'requested') return res.status(409).json({ error: 'That hand is no longer raised.' });
          guest.mic = 'listener';
        } else if (action === 'demote') {
          guest.live = false;
          guest.mic = 'listener';
        } else {
          room.removed.add(target);
          room.members.delete(target);
          if (target === room.cohost) room.cohost = null;
        }
        break;
      }
      case 'message': {
        if ((room.commentPauses.get(user) || 0) > Date.now()) return res.status(403).json({ error: 'A room admin temporarily paused your comments.' });
        if (typeof text !== 'string' || !text.trim() || text.length > 300) return res.status(400).json({ error: 'Write a message of up to 300 characters.' });
        if (member.lastMessage && Date.now() - member.lastMessage < 1000) return res.status(429).json({ error: 'Wait a moment before sending again.' });
        member.lastMessage = Date.now();
        if (!await enforceText(req, res, text)) return;
        if (!rooms.has(room.id) || room.members.get(user) !== member) return res.status(403).json({ error: 'You’re no longer in this Lounge.' });
        if ((room.commentPauses.get(user) || 0) > Date.now()) return res.status(403).json({ error: 'A room admin temporarily paused your comments.' });
        room.messages.push({ id: randomUUID(), user, text: text.trim() });
        if (room.messages.length > 60) room.messages.shift();
        break;
      }
      case 'react':
        if ((room.commentPauses.get(user) || 0) > Date.now()) return res.status(403).json({ error: 'A room admin temporarily paused your comments and reactions.' });
        if (!['👏', '💜', '😂'].includes(text)) return res.status(400).json({ error: 'Choose a room reaction.' });
        if (member.lastMessage && Date.now() - member.lastMessage < 1000) return res.status(429).json({ error: 'Wait a moment before reacting again.' });
        member.lastMessage = Date.now();
        room.messages.push({ id: randomUUID(), user, text, reaction: true });
        if (room.messages.length > 60) room.messages.shift();
        break;
      default: return res.status(400).json({ error: 'Unknown Lounge action.' });
    }
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.post('/:roomId/signal', async (req, res, next) => {
  const room = req.room;
  const from = req.user.userId;
  const { to, speaker, link, payload } = req.body;
  if (to === from || !room.members.has(to) || ![from, to].includes(speaker) ||
      typeof link !== 'string' || !/^[\da-f-]{36}$/i.test(link) ||
      !['offer', 'answer', 'candidate'].includes(payload?.type) || JSON.stringify(payload).length > 16000 ||
      (payload.type === 'offer' && speaker !== from) || (payload.type === 'answer' && speaker !== to)) {
    return res.status(400).json({ error: 'Invalid Lounge signal.' });
  }
  try {
    const visible = await visibleUsers([to], from);
    if (!visible.length || !room.members.get(speaker)?.live || !room.members.has(from) || !room.members.has(to) || !rooms.has(room.id)) {
      return res.status(403).json({ error: 'This audio link is unavailable.' });
    }
    if (room.signals.length >= 3000) return res.status(429).json({ error: 'Lounge signaling is busy.' });
    room.signals.push({ id: ++room.cursor, from, to, speaker, link, payload, at: Date.now() });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

module.exports = router;
