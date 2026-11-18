const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { visiblePostSql } = require('../postPrivacy');
const { enforceText } = require('../textModeration');

const router = express.Router();
router.use(authenticate);

function fail(res, error) {
  console.error('Murmurs error:', error);
  res.status(500).json({ error: 'Murmurs are temporarily unavailable.' });
}

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { rows } = await db.query(`
      SELECT m.user_id, m.body, m.expires_at, a.aura_name, m.user_id = $1 AS own,
        CASE WHEN m.user_id = $1 OR EXISTS (
          SELECT 1 FROM matches connection
          WHERE connection.revealed AND (
            (connection.user1_id = $1 AND connection.user2_id = m.user_id)
            OR (connection.user2_id = $1 AND connection.user1_id = m.user_id)
          )
        ) THEN u.profile_photo END AS profile_photo
      FROM murmurs m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN auras a ON a.user_id = m.user_id
      CROSS JOIN LATERAL (SELECT m.user_id, 'connections'::text AS visibility) audience
      WHERE m.expires_at > NOW() AND ${visiblePostSql('audience', '$1', false)}
      ORDER BY own DESC, m.expires_at DESC, m.user_id
    `, [req.user.userId]);
    res.json(rows);
  } catch (error) {
    fail(res, error);
  }
});

router.put('/mine', async (req, res) => {
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body || Array.from(body).length > 80) {
    return res.status(400).json({ error: 'Write a Murmur of 1 to 80 characters.' });
  }
  try {
    if (!await enforceText(req, res, body)) return;
    const { rows: [murmur] } = await db.query(`
      INSERT INTO murmurs (user_id, body) VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET body = EXCLUDED.body, expires_at = EXCLUDED.expires_at
      RETURNING user_id, body, expires_at, TRUE AS own
    `, [req.user.userId, body]);
    res.json(murmur);
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/mine', async (req, res) => {
  try {
    await db.query('DELETE FROM murmurs WHERE user_id = $1', [req.user.userId]);
    res.sendStatus(204);
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
