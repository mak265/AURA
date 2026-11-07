const db = require('./db');
function receiptHandler(kind) {
  const messages = kind === 'match' ? 'messages' : 'aura_session_messages';
  const conversations = kind === 'match' ? 'matches' : 'aura_sessions';
  const column = kind === 'match' ? 'match_id' : 'session_id';
  return async (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length > 200 || ids.some(id => !Number.isInteger(id) || id <= 0) || typeof req.body.read !== 'boolean') {
      return res.status(400).json({ error: 'Provide message IDs and a read status.' });
    }
    try {
      const id = Number(req.params.matchId || req.params.sessionId);
      const member = await db.query(`SELECT id FROM ${conversations} WHERE id=$1 AND (user1_id=$2 OR user2_id=$2)`, [id, req.user.userId]);
      if (!member.rowCount) return res.status(404).json({ error: 'Conversation not found.' });
      const result = await db.query(`UPDATE ${messages} SET delivered_at=COALESCE(delivered_at,NOW()),
        read_at=CASE WHEN $4 THEN COALESCE(read_at,NOW()) ELSE read_at END
        WHERE ${column}=$1 AND sender_id!=$2 AND id=ANY($3::int[])
        RETURNING id,delivered_at,read_at`, [id,req.user.userId,ids,req.body.read]);
      res.json(result.rows);
    } catch (error) {
      console.error('Message receipt error:', error);
      res.status(500).json({ error: 'Unable to update message status.' });
    }
  };
}
module.exports = { receiptHandler };
