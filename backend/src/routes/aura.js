const { enforceText } = require('../textModeration');
const { validateConnectionProfile, saveConnectionProfile } = require('../connectionProfile');
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/interests - list all interests
router.get('/interests', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM interests ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Get interests error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/aura/me - get current user's aura profile
router.get('/me', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;

    const userResult = await db.query(
      'SELECT id, email, real_name, age, gender, religion, city, profile_photo FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const auraResult = await db.query('SELECT * FROM auras WHERE user_id = $1', [userId]);
    const interestsResult = await db.query(
      `SELECT i.id, i.name, i.emoji FROM interests i
       JOIN user_interests ui ON ui.interest_id = i.id
       WHERE ui.user_id = $1`,
      [userId]
    );

    res.json({
      user: userResult.rows[0],
      aura: auraResult.rows[0] || null,
      interests: interestsResult.rows,
    });
  } catch (err) {
    console.error('Get aura error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// PUT /api/aura - create/update aura profile
router.put('/', authenticate, async (req, res) => {
  try {
    const error = validateConnectionProfile(req.body);
    if (error) return res.status(400).json({ error });
    const userId = req.user.userId;
    const { aura_name, aura_color, vibe, bio, emoji, interests } = req.body;

    if (!aura_name) {
      return res.status(400).json({ error: 'Aura name is required.' });
    }

    if(!await enforceText(req,res,[aura_name,bio,vibe,...(req.body.prompt_answers||[])].join(' ')))return;
    const existing = await db.query('SELECT user_id FROM auras WHERE user_id = $1', [userId]);

    if (existing.rows.length > 0) {
      await db.query(
        `UPDATE auras SET aura_name = $1, aura_color = $2, vibe = $3, bio = $4, emoji = $5, updated_at = NOW()
         WHERE user_id = $6`,
        [aura_name, aura_color || 'violet', vibe || '', bio || '', emoji || '🌌', userId]
      );
    } else {
      await db.query(
        `INSERT INTO auras (user_id, aura_name, aura_color, vibe, bio, emoji)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, aura_name, aura_color || 'violet', vibe || '', bio || '', emoji || '🌌']
      );
    }

    // Update interests
    if (Array.isArray(interests)) {
      await db.query('DELETE FROM user_interests WHERE user_id = $1', [userId]);
      for (const interestId of interests) {
        await db.query(
          'INSERT INTO user_interests (user_id, interest_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, interestId]
        );
      }
    }

    await saveConnectionProfile(db, userId, req.body);
    res.json({ message: 'Aura profile saved successfully.' });
  } catch (err) {
    console.error('Update aura error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// PUT /api/aura/about - update about-you fields
router.put('/about', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { age, gender, religion, city, real_name } = req.body;

    await db.query(
      `UPDATE users SET age = $1, gender = $2, religion = $3, city = $4, real_name = $5, updated_at = NOW()
       WHERE id = $6`,
      [age || null, gender || null, religion || null, city || null, real_name || null, userId]
    );

    res.json({ message: 'About you saved successfully.' });
  } catch (err) {
    console.error('Update about error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
