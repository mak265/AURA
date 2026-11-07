const { profileVisibleSql, canSeeProfile } = require('../profileVisibility');
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Compute from the batched candidate/interest data, without queries per card.
function computeCompatibility(me,them,myInterests,theirInterests){
 const shared=theirInterests.filter(interest=>myInterests.has(interest.id));
 let score=Math.min(shared.length*10,50)+20;const reasons=[];
 if(shared.length)reasons.push(`${shared.length} shared interest${shared.length>1?'s':''}`);
 if(me.age&&them.age&&Math.abs(me.age-them.age)<=5){score+=15;reasons.push('Age preference matches');}
 if(me.religion&&them.religion&&me.religion===them.religion){score+=15;reasons.push('Same religion preference');}
 reasons.push('Within preferred distance');return {score:Math.min(score,99),reasons};
}

// GET /api/discover - list anonymous aura cards
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { gender, religion, age_min, age_max, interests, dating_intention } = req.query;

    if(req.query.q!==undefined && (typeof req.query.q!=='string'||req.query.q.length>80))return res.status(400).json({error:'Search must be 80 characters or fewer.'});
    const search=(req.query.q||'').trim();
    // Get users I've already liked or matched with
    const liked = await db.query(
      `SELECT receiver_id FROM likes WHERE sender_id = $1
       UNION
       SELECT user1_id FROM matches WHERE user2_id = $1
       UNION
       SELECT user2_id FROM matches WHERE user1_id = $1`,
      [userId]
    );
    const excludedIds = liked.rows.map(r => r.receiver_id || r.user1_id || r.user2_id);
    excludedIds.push(userId);

    let query = `
      SELECT u.id, u.age, u.gender, u.religion, u.city,
             a.aura_name, a.aura_color, a.vibe, a.bio, a.emoji, a.dating_intention, a.prompt_answers
      FROM users u
      JOIN auras a ON a.user_id = u.id
      WHERE u.id != ALL($1) AND ${profileVisibleSql('u.id','$2')}
    `;
    const params = [excludedIds,userId];

    if(search){params.push(search);query+=` AND POSITION(LOWER($${params.length}::text) IN LOWER(a.aura_name))>0`;}
    if (dating_intention) {
      params.push(dating_intention);
      query += ` AND a.dating_intention = $${params.length}`;
    }
    if (gender) {
      params.push(gender);
      query += ` AND u.gender = $${params.length}`;
    }
    if (religion) {
      params.push(religion);
      query += ` AND u.religion = $${params.length}`;
    }
    if (age_min) {
      params.push(parseInt(age_min));
      query += ` AND u.age >= $${params.length}`;
    }
    if (age_max) {
      params.push(parseInt(age_max));
      query += ` AND u.age <= $${params.length}`;
    }

    query += search ? ' ORDER BY LOWER(a.aura_name),u.id LIMIT 20' : ' ORDER BY RANDOM() LIMIT 20';

    const result = await db.query(query, params);
    const cards = [];

    const [meResult,interestResult]=await Promise.all([
      db.query('SELECT age,religion FROM users WHERE id=$1',[userId]),
      db.query('SELECT ui.user_id,i.id,i.name,i.emoji FROM user_interests ui JOIN interests i ON i.id=ui.interest_id WHERE ui.user_id=ANY($1::int[])',[[userId,...result.rows.map(row=>row.id)]])
    ]);
    const interestsByUser=new Map();
    for(const interest of interestResult.rows){if(!interestsByUser.has(interest.user_id))interestsByUser.set(interest.user_id,[]);interestsByUser.get(interest.user_id).push(interest);}
    const myInterests=new Set((interestsByUser.get(userId)||[]).map(interest=>interest.id));
    for (const row of result.rows) {
      const theirInterests=interestsByUser.get(row.id)||[];
      const {score,reasons}=computeCompatibility(meResult.rows[0]||{},row,myInterests,theirInterests);
      cards.push({
        id: row.id,
        aura_name: row.aura_name,
        aura_color: row.aura_color,
        emoji: row.emoji,
        age: row.age,
        gender: row.gender,
        religion: row.religion,
        city: row.city,
        vibe: row.vibe,
        bio: row.bio,
        dating_intention: row.dating_intention,
        prompt_answers: row.prompt_answers,
        interests: theirInterests.map(({name,emoji})=>({name,emoji})),
        compatibility: score,
        reasons,
        identity_hidden: true,
      });
    }

    // Filter by interests if specified
    let filtered = cards;
    if (interests) {
      const interestNames = interests.split(',').map(s => s.trim().toLowerCase());
      filtered = cards.filter(card =>
      card.interests.some(i => interestNames.includes(i.name.toLowerCase()))
      );
    }

    res.json(filtered);
  } catch (err) {
    console.error('Discover error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/discover/:userId/send-aura
router.post('/:userId/send-aura', authenticate, async (req, res) => {
  try {
    const senderId = req.user.userId;
    const receiverId = parseInt(req.params.userId);

    if (senderId === receiverId) {
      return res.status(400).json({ error: 'Cannot send aura to yourself.' });
    }

    if (!Number.isInteger(receiverId) || !await canSeeProfile(receiverId,senderId)) return res.status(404).json({error:'Aura not found.'});

    // Check if already liked
    const existing = await db.query(
      'SELECT id FROM likes WHERE sender_id = $1 AND receiver_id = $2',
      [senderId, receiverId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Aura already sent.' });
    }

    await db.query(
      'INSERT INTO likes (sender_id, receiver_id) VALUES ($1, $2)',
      [senderId, receiverId]
    );

    // Check for mutual like
    const mutual = await db.query(
      'SELECT id FROM likes WHERE sender_id = $1 AND receiver_id = $2',
      [receiverId, senderId]
    );

    let matched = false;
    let matchId = null;
    if (mutual.rows.length > 0) {
      // Create match
      const matchResult = await db.query(
        `INSERT INTO matches (user1_id, user2_id) VALUES ($1, $2) RETURNING id`,
        [senderId, receiverId]
      );
      matched = true;
      matchId = matchResult.rows[0].id;
    }

    res.json({
      message: matched ? "It's an Aura Match!" : 'Aura sent successfully.',
      matched,
      matchId,
    });
  } catch (err) {
    console.error('Send aura error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;

