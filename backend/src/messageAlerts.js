const db = require('./db');
const { sendNativePush } = require('./nativePush');

async function notifyActivity(io, recipientId, senderId, { path, body, matchId = null }) {
  if (!recipientId || recipientId === senderId) return;
  const { rows: [recipient] } = await db.query(`
    SELECT u.auth_version FROM users u
    WHERE u.id = $1 AND u.banned_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM conversation_preferences WHERE user_id = u.id AND match_id = $2 AND muted)
      AND NOT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = u.id AND blocked_id = $3)
        OR (blocker_id = $3 AND blocked_id = u.id))
  `, [recipientId, matchId, senderId]);
  if (!recipient) return;
  const sockets = io ? await io.in(`alerts:${recipientId}`).fetchSockets() : [];
  for (const socket of sockets) {
    if (socket.data.alertAuthVersion !== recipient.auth_version) continue;
    if (body) socket.emit('alert:activity', { path, body });
    else socket.emit('alert:message', { path });
  }
  await sendNativePush(recipientId, recipient.auth_version, path, body);
}

function notifyMessage(io, recipientId, senderId, matchId) {
  return notifyActivity(io, recipientId, senderId, { path: `/chat/${matchId}`, matchId });
}

module.exports = { notifyMessage, notifyActivity };
