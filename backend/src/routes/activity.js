const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { profileVisibleSql } = require('../profileVisibility');
const { visiblePostSql } = require('../postPrivacy');

const router = express.Router();
router.use(authenticate, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const noBlock = owner => `NOT EXISTS (SELECT 1 FROM blocks b WHERE
  (b.blocker_id=$1 AND b.blocked_id=${owner}) OR (b.blocked_id=$1 AND b.blocker_id=${owner}))`;
const auraName = owner => `CASE WHEN ${profileVisibleSql(owner, '$1')} THEN a.aura_name END`;

const events = `WITH activity AS (
  SELECT 'journal' AS source, n.id AS source_id, n.actor_id,
    CASE WHEN n.body='Someone reacted to your post.' THEN 'journal-reaction:' || n.post_id ELSE 'journal:' || n.id END AS event_key,
    ${auraName('n.actor_id')} AS actor_name, n.body, NULL::text AS detail,
    '/feed?post=' || n.post_id || CASE WHEN n.opens_comments THEN '&comments=1' ELSE '' END AS path,
    n.created_at, n.read_at
  FROM journal_activity n JOIN posts p ON p.id=n.post_id LEFT JOIN auras a ON a.user_id=n.actor_id
  WHERE n.recipient_id=$1 AND ${visiblePostSql('p', '$1')} AND ${noBlock('n.actor_id')}
  UNION ALL
  SELECT 'aura', l.id, l.sender_id, 'aura:' || l.id, a.aura_name, 'Someone sent you an Aura.', NULL,
    '/discover?aura=' || l.id, l.created_at, NULL
  FROM likes l JOIN auras a ON a.user_id=l.sender_id
  WHERE l.receiver_id=$1 AND l.receiver_dismissed_at IS NULL AND ${profileVisibleSql('l.sender_id', '$1')}
    AND (l.opener IS NOT NULL OR NOT EXISTS (SELECT 1 FROM matches m WHERE
      (m.user1_id=l.sender_id AND m.user2_id=$1) OR (m.user2_id=l.sender_id AND m.user1_id=$1)))
  UNION ALL
  SELECT 'glimpse-reply', r.id, r.sender_id, 'glimpse-reply:' || r.id, ${auraName('r.sender_id')},
    'Someone replied to your Glimpse.', r.body, '/feed?glimpse=' || g.id, r.created_at, NULL
  FROM glimpse_replies r JOIN glimpses g ON g.id=r.glimpse_id LEFT JOIN auras a ON a.user_id=r.sender_id
  WHERE g.user_id=$1 AND g.expires_at>NOW() AND ${noBlock('r.sender_id')}
    AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=r.sender_id AND u.banned_at IS NOT NULL)
  UNION ALL
  SELECT 'lounge-invite', msg.id, msg.sender_id, 'lounge-invite:' || msg.id, ${auraName('msg.sender_id')},
    'Someone invited you to a Lounge.', NULL, msg.content, msg.created_at, NULL
  FROM matches m JOIN messages msg ON msg.match_id=m.id LEFT JOIN auras a ON a.user_id=msg.sender_id
  WHERE (m.user1_id=$1 OR m.user2_id=$1) AND msg.sender_id<>$1 AND msg.unsent_at IS NULL
    AND msg.content LIKE '/aura-lounge?room=%'
    AND msg.content ~ '^/aura-lounge[?]room=[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
    AND ${profileVisibleSql('msg.sender_id', '$1')}
    AND NOT EXISTS (SELECT 1 FROM hidden_messages h WHERE h.user_id=$1 AND h.message_id=msg.id)
    AND NOT EXISTS (SELECT 1 FROM conversation_preferences cp WHERE cp.user_id=$1 AND cp.match_id=m.id
      AND (cp.muted OR msg.created_at<=cp.deleted_at))
  UNION ALL
  SELECT 'meet-session', s.id, NULL::int, 'meet-session:' || s.id, NULL,
    s.title || ' is live. Open Meet to join.', NULL, '/aura-chat?session=' || s.id, r.notified_at, r.read_at
  FROM meet_session_reminders r JOIN meet_sessions s ON s.id=r.session_id
  WHERE r.user_id=$1 AND r.notified_at IS NOT NULL AND s.cancelled_at IS NULL
), visible_activity AS (
  SELECT a.*, COALESCE(a.read_at, r.read_at) AS seen_at
  FROM activity a LEFT JOIN app_activity_reads r ON r.user_id=$1 AND r.source=a.source AND r.source_id=a.source_id
)`;

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(`${events}, grouped AS (
      SELECT event_key AS id, min(source) AS source, max(created_at) AS created_at, min(path) AS path,
        min(body) AS body, min(detail) AS detail, bool_and(seen_at IS NOT NULL) AS read,
        count(DISTINCT actor_id)::int AS actor_count,
        (array_agg(actor_name ORDER BY created_at DESC, source_id DESC))[1] AS actor_name
      FROM visible_activity GROUP BY event_key
    ) SELECT *, count(*) FILTER (WHERE NOT read) OVER ()::int AS unread
    FROM grouped ORDER BY created_at DESC, id DESC LIMIT 50`, [req.user.userId]);
    res.json({ items: rows, unread: rows[0]?.unread ?? 0 });
  } catch (error) { next(error); }
});

router.patch('/read', async (req, res, next) => {
  const { id } = req.body || {};
  if (id !== undefined && (typeof id !== 'string' || !/^(journal|journal-reaction|aura|glimpse-reply|lounge-invite|meet-session):[1-9]\d{0,9}$/.test(id))) {
    return res.status(400).json({ error: 'Invalid activity item.' });
  }
  try {
    await db.query(`${events}, selected AS (
      SELECT source, source_id FROM visible_activity WHERE seen_at IS NULL AND ($2::text IS NULL OR event_key=$2)
    ), journal_read AS (
      UPDATE journal_activity SET read_at=NOW() WHERE recipient_id=$1 AND read_at IS NULL AND id IN (
        SELECT source_id FROM selected WHERE source='journal'
      )
    ) INSERT INTO app_activity_reads (user_id, source, source_id)
    SELECT $1, source, source_id FROM selected WHERE source<>'journal' ON CONFLICT DO NOTHING`, [req.user.userId, id ?? null]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

module.exports = router;
