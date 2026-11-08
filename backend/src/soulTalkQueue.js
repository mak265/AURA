const {parseOptions,checkAllowance,charge} = require('./auraFarming');
const { profileVisibleSql } = require('./profileVisibility');
const db = require('./db');

// Allow background-tab heartbeat delays while still expiring abandoned searches.
const SEARCH_LEASE_SECONDS = 90;
async function startSearch(userId, partnerId = null, options = {}) {
  const {mode,filters} = parseOptions(options);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize queue selection and joining across requests and server processes.
    await client.query('SELECT pg_advisory_xact_lock(68421001)');
    await client.query(`UPDATE aura_sessions SET status = 'ended'
      WHERE (status = 'waiting' AND (search_expires_at IS NULL OR search_expires_at <= NOW()))
         OR (status = 'active' AND created_at <= NOW() - INTERVAL '5 minutes')`);

    if (partnerId !== null) {
      const match = await client.query(`SELECT id FROM matches
        WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`, [userId, partnerId]);
      if (!match.rowCount) throw Object.assign(new Error('Match not found.'), { status: 404 });
    }
    const existing = await client.query(`SELECT id, status, requested_partner_id, mode, search_filters FROM aura_sessions
      WHERE (user1_id = $1 OR user2_id = $1) AND status IN ('waiting', 'active')
      ORDER BY id DESC LIMIT 1 FOR UPDATE`, [userId]);
    const previous = existing.rows[0];
    if (previous?.status === 'active') {
      await client.query('COMMIT');
      return previous.id;
    }
    if (partnerId === null || filters.religion) await checkAllowance(client,userId,mode,filters);
    if (previous && previous.requested_partner_id === partnerId && previous.mode === mode && Object.keys(filters).every(key => (previous.search_filters[key] ?? (key.startsWith('age') ? null : '')) === filters[key])) {
      await client.query(`UPDATE aura_sessions SET search_expires_at = NOW() + $2 * INTERVAL '1 second' WHERE id = $1`, [previous.id, SEARCH_LEASE_SECONDS]);
      await client.query('COMMIT');
      return previous.id;
    }
    if (previous) await client.query("UPDATE aura_sessions SET status = 'ended' WHERE id = $1", [previous.id]);

    const waiting = await client.query(`SELECT s.id FROM aura_sessions s
      JOIN users candidate ON candidate.id=s.user1_id
      JOIN users seeker ON seeker.id=$1
      LEFT JOIN farming_usage usage ON usage.user_id=candidate.id
      WHERE s.mode=$3 AND s.user1_id != $1
        AND candidate.banned_at IS NULL AND seeker.banned_at IS NULL
        AND ($2::integer IS NOT NULL OR candidate.premium_until>NOW() OR usage.user_id IS NULL OR usage.window_started_at+INTERVAL '24 hours'<=NOW() OR CASE WHEN $3='call' THEN usage.calls<3 ELSE usage.chats<5 END)
        AND (COALESCE(s.search_filters->>'religion','')='' OR candidate.premium_until>NOW())
        AND (($4::jsonb->>'ageMin') IS NULL OR candidate.age>=($4::jsonb->>'ageMin')::int)
        AND (($4::jsonb->>'ageMax') IS NULL OR candidate.age<=($4::jsonb->>'ageMax')::int)
        AND (COALESCE($4::jsonb->>'gender','')='' OR LOWER(candidate.gender)=LOWER($4::jsonb->>'gender'))
        AND (COALESCE($4::jsonb->>'religion','')='' OR LOWER(candidate.religion)=LOWER($4::jsonb->>'religion'))
        AND ((s.search_filters->>'ageMin') IS NULL OR seeker.age>=(s.search_filters->>'ageMin')::int)
        AND ((s.search_filters->>'ageMax') IS NULL OR seeker.age<=(s.search_filters->>'ageMax')::int)
        AND (COALESCE(s.search_filters->>'gender','')='' OR LOWER(seeker.gender)=LOWER(s.search_filters->>'gender'))
        AND (COALESCE(s.search_filters->>'religion','')='' OR LOWER(seeker.religion)=LOWER(s.search_filters->>'religion')) AND s.user2_id IS NULL AND s.status = 'waiting'
        AND s.search_expires_at > NOW()
        AND ${profileVisibleSql('s.user1_id','$1')}
        AND ${profileVisibleSql('$1','s.user1_id')}
        AND (($2::integer IS NULL AND s.requested_partner_id IS NULL)
          OR (s.user1_id = $2 AND s.requested_partner_id = $1))
        AND NOT EXISTS (SELECT 1 FROM blocks b
          WHERE (b.blocker_id = $1 AND b.blocked_id = s.user1_id)
             OR (b.blocked_id = $1 AND b.blocker_id = s.user1_id))
        AND NOT EXISTS (SELECT 1 FROM aura_sessions busy
          WHERE busy.status = 'active' AND (busy.user1_id = s.user1_id OR busy.user2_id = s.user1_id))
      ORDER BY s.created_at, s.id LIMIT 1 FOR UPDATE OF s`, [userId, partnerId, mode, JSON.stringify(filters)]);
    let result;
    if (waiting.rowCount) {
      if (partnerId === null) {
        const owner = await client.query('SELECT user1_id FROM aura_sessions WHERE id=$1',[waiting.rows[0].id]);
        await charge(client,owner.rows[0].user1_id,mode);
        await charge(client,userId,mode);
      }
      result = await client.query(`UPDATE aura_sessions SET user2_id = $1, status = 'active',
        created_at = NOW(), search_expires_at = NULL WHERE id = $2 RETURNING id`, [userId, waiting.rows[0].id]);
    } else {
      result = await client.query(`INSERT INTO aura_sessions (user1_id, status, requested_partner_id, search_expires_at, mode, search_filters)
        VALUES ($1, 'waiting', $2, NOW() + $3 * INTERVAL '1 second', $4, $5) RETURNING id`, [userId, partnerId, SEARCH_LEASE_SECONDS, mode, JSON.stringify(filters)]);
    }
    await client.query('COMMIT');
    return result.rows[0].id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function heartbeat(sessionId, userId) {
  // An expired lease cannot be revived by a delayed/background request.
  await db.query(`UPDATE aura_sessions SET search_expires_at = NOW() + $3 * INTERVAL '1 second'
    WHERE id = $1 AND user1_id = $2 AND status = 'waiting' AND search_expires_at > NOW()`,
    [sessionId, userId, SEARCH_LEASE_SECONDS]);
}
module.exports = { startSearch, heartbeat };
