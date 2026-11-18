import api from '../api/client';

export function createLoungeAudio(roomId, userId, onAudioError) {
  const peers = new Map();
  const muted = new Set();
  let cursor = 0;
  let closed = false;
  let iceConfig;
  const endpoint = `/lounge/${roomId}/signal`;

  function closePeer(key) {
    const peer = peers.get(key);
    if (!peer) return;
    peers.delete(key);
    peer.pc.close();
    if (peer.audio) peer.audio.srcObject = null;
  }

  async function createPeer(key, other, speaker, link) {
    iceConfig ??= api.get('/aura-chat/call-config', { timeout: 5000 }).then(result => result.data)
      .catch(error => { iceConfig = null; throw error; });
    const config = await iceConfig;
    if (closed) return null;
    const pc = new RTCPeerConnection(config);
    const peer = { pc, other, speaker, link, candidates: [], queue: Promise.resolve() };
    peers.set(key, peer);
    peer.send = payload => {
      const task = peer.queue.then(() => {
        if (peers.get(key) === peer) return api.post(endpoint, { to: other, speaker, link, payload }, { timeout: 5000 });
      });
      peer.queue = task.catch(() => {});
      return task;
    };
    const localCandidates = [];
    peer.publish = async description => {
      const sending = peer.send({ type: description.type, sdp: description.sdp });
      peer.published = true;
      for (const candidate of localCandidates) peer.send(candidate).catch(() => {});
      await sending;
    };
    pc.onicecandidate = event => {
      if (!event.candidate) return;
      const candidate = { type: 'candidate', candidate: event.candidate.toJSON() };
      if (peer.published) peer.send(candidate).catch(() => {});
      else localCandidates.push(candidate);
    };
    pc.ontrack = event => {
      const audio = peer.audio ??= new Audio();
      audio.muted = muted.has(other);
      audio.srcObject = event.streams[0];
      audio.play().catch(onAudioError);
    };
    return peer;
  }

  async function update(room, stream) {
    if (closed) return;
    const members = new Map(room.members.map(member => [member.id, member]));
    for (const [key, peer] of peers) {
      if (peer.pc.connectionState === 'disconnected') peer.disconnectedAt ??= Date.now();
      else peer.disconnectedAt = null;
      if (!members.has(peer.other) || !members.get(peer.speaker)?.live ||
          (peer.speaker === userId && (!stream || peer.otherVersion !== members.get(peer.other)?.audioVersion ||
            peer.pc.connectionState === 'failed' ||
            (peer.disconnectedAt && Date.now() - peer.disconnectedAt > 4000)))) closePeer(key);
    }
    for (const signal of room.signals) {
      if (closed) return;
      cursor = Math.max(cursor, signal.id);
      if (!members.get(signal.speaker)?.live) continue;
      const key = signal.speaker === userId ? `out:${signal.from}` : `in:${signal.from}`;
      try {
        let peer = peers.get(key);
        if (signal.payload.type === 'offer' && peer?.link !== signal.link) {
          closePeer(key);
          peer = await createPeer(key, signal.from, signal.speaker, signal.link);
        }
        if (!peer || peer.link !== signal.link) continue;
        if (signal.payload.type === 'candidate') {
          if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signal.payload.candidate);
          else peer.candidates.push(signal.payload.candidate);
          continue;
        }
        await peer.pc.setRemoteDescription(signal.payload);
        for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
        if (signal.payload.type === 'offer') {
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          await peer.publish(peer.pc.localDescription);
        }
      } catch { closePeer(key); }
    }
    if (!stream || !members.get(userId)?.live) return;
    await Promise.all([...members.keys()].filter(other => other !== userId).map(async other => {
      const key = `out:${other}`;
      if (peers.has(key)) return;
      try {
        const peer = await createPeer(key, other, userId, crypto.randomUUID());
        if (!peer) return;
        peer.otherVersion = members.get(other).audioVersion;
        stream.getAudioTracks().forEach(track => peer.pc.addTrack(track, stream));
        await peer.pc.setLocalDescription(await peer.pc.createOffer());
        await peer.publish(peer.pc.localDescription);
      } catch { closePeer(key); }
    }));
  }

  return {
    get cursor() { return cursor; },
    resetPeers() { for (const key of peers.keys()) closePeer(key); },
    needsAudioRecovery(room) {
      return room.members.some(member => member.id !== userId && member.live && !muted.has(member.id) &&
        peers.get(`in:${member.id}`)?.pc.connectionState !== 'connected');
    },
    update,
    setMuted(user, value) {
      if (value) muted.add(user);
      else muted.delete(user);
      const audio = peers.get(`in:${user}`)?.audio;
      if (audio) {
        audio.muted = value;
        if (!value) audio.play().catch(onAudioError);
      }
    },
    async speakingUsers() {
      const speaking = new Set();
      let localPeer;
      for (const peer of peers.values()) {
        if (peer.speaker === userId) {
          localPeer ??= peer;
          continue;
        }
        if (!muted.has(peer.speaker) && peer.pc.getReceivers().some(receiver =>
          receiver.getSynchronizationSources?.().some(source =>
            performance.now() - source.timestamp < 500 && source.audioLevel > .025))) {
          speaking.add(peer.speaker);
        }
      }
      if (localPeer) {
        const stats = await localPeer.pc.getStats();
        if ([...stats.values()].some(stat => stat.type === 'media-source' && stat.kind === 'audio' && stat.audioLevel > .025)) {
          speaking.add(userId);
        }
      }
      return [...speaking].sort((a, b) => a - b);
    },
    resume: () => Promise.all([...peers.values()].filter(peer => peer.audio).map(peer => peer.audio.play())),
    close() { closed = true; for (const key of peers.keys()) closePeer(key); },
  };
}
