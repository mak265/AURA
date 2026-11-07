const db = require('./db');

async function revealSoulTalk(sessionId, userId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(68421001)');
    const result = await client.query(`SELECT *, created_at <= NOW() - INTERVAL '1 minute' AS reveal_ready,
      created_at <= NOW() - INTERVAL '5 minutes' AS timer_finished
      FROM aura_sessions WHERE id = $1 AND (user1_id = $2 OR user2_id = $2) FOR UPDATE`, [sessionId, userId]);
    const session = result.rows[0];
    if (!session) throw Object.assign(new Error('Session not found.'), { status: 404 });
    if (!session.user2_id || !session.reveal_ready || !['active', 'matched', 'ended'].includes(session.status) ||
        (session.status === 'ended' && !session.timer_finished)) {
      throw Object.assign(new Error('Show identity becomes available after one minute of conversation.'), { status: 403 });
    }
    const findMatch = () => client.query(`SELECT id FROM matches WHERE
      (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1) ORDER BY id LIMIT 1`, [session.user1_id, session.user2_id]);
    if (session.status === 'matched') {
      const match = await findMatch();
      await client.query('COMMIT');
      return { matched: true, matchId: match.rows[0].id };
    }
    await client.query(`INSERT INTO aura_session_answers (session_id,user_id,round,answer)
      SELECT $1,$2,98,'reveal_identity' WHERE NOT EXISTS (
        SELECT 1 FROM aura_session_answers WHERE session_id=$1 AND user_id=$2 AND round=98 AND answer='reveal_identity')`, [sessionId, userId]);
    const votes = await client.query(`SELECT count(DISTINCT user_id)::int AS total FROM aura_session_answers
      WHERE session_id=$1 AND user_id IN ($2,$3) AND round=98 AND answer='reveal_identity'`, [sessionId, session.user1_id, session.user2_id]);
    if (votes.rows[0].total < 2) {
      await client.query('COMMIT');
      return { matched: false, matchId: null, message: 'Waiting for the other person to show their identity too.' };
    }
    let match = await findMatch();
    if (!match.rowCount) {
      match = await client.query(`INSERT INTO matches (user1_id,user2_id,soul_game_completed,revealed)
        VALUES ($1,$2,TRUE,TRUE) RETURNING id`, [session.user1_id, session.user2_id]);
    } else {
      await client.query('UPDATE matches SET soul_game_completed=TRUE, revealed=TRUE WHERE id=$1', [match.rows[0].id]);
    }
    const matchId = match.rows[0].id;
    // Move the conversation once, inside the same transaction as mutual consent.
    await client.query(`INSERT INTO messages (match_id,sender_id,content,created_at,delivered_at,read_at)
      SELECT $1,sender_id,content,created_at,delivered_at,read_at FROM aura_session_messages WHERE session_id=$2 ORDER BY created_at,id`, [matchId,sessionId]);
    await client.query("UPDATE aura_sessions SET status='matched' WHERE id=$1", [sessionId]);
    await client.query('COMMIT');
    return { matched: true, matchId, message: 'Identity revealed. Keep talking without a timer.' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
module.exports = { revealSoulTalk };
