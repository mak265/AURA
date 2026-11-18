async function finishConnectionCalls(db, { matchId = null, callId = null, userId = null } = {}) {
  await db.query(`
    WITH finished AS (
      DELETE FROM connection_calls
      WHERE ($1::int IS NULL OR match_id = $1)
        AND CASE WHEN $2::int IS NOT NULL THEN id = $2 ELSE
          expires_at <= NOW() OR (status = 'active' AND LEAST(caller_seen_at, recipient_seen_at) <= NOW() - INTERVAL '75 seconds')
        END
      RETURNING *,
        CASE WHEN $2 IS NOT NULL THEN NOW()
          WHEN status = 'ringing' THEN expires_at
          ELSE LEAST(expires_at, GREATEST(connected_at, LEAST(caller_seen_at, recipient_seen_at))) END AS ended_at
    )
    INSERT INTO messages (match_id, sender_id, kind, content, duration_seconds, created_at)
    SELECT match_id, caller_id, 'call',
      CASE WHEN connected_at IS NOT NULL THEN 'Voice call ended'
           WHEN status = 'active' THEN 'Call did not connect'
           WHEN $2 IS NULL THEN 'Missed voice call'
           WHEN caller_id = $3::int THEN 'Call canceled'
           ELSE 'Call declined' END,
      CASE WHEN connected_at IS NOT NULL THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ended_at - connected_at))) END,
      ended_at
    FROM finished
  `, [matchId, callId, userId]);
}

module.exports = { finishConnectionCalls };
