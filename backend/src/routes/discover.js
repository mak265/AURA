const { profileVisibleSql } = require('../profileVisibility');
const { recordProfileView } = require('../profileViews');
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { enforceText } = require('../textModeration');

const router = express.Router();
router.use('/auras',require('./discoverAuras'));

router.post('/:userId/view', authenticate, async (req, res) => {
  const ownerId = Number(req.params.userId);
  if (!Number.isInteger(ownerId) || ownerId < 1 || ownerId > 2147483647) {
    return res.status(400).json({ error: 'Invalid profile.' });
  }
  try {
    const recorded = await recordProfileView(ownerId, req.user.userId);
    if (!recorded) return res.status(404).json({ error: 'Profile unavailable.' });
    res.sendStatus(204);
  } catch (error) {
    console.error('Discover profile view error:', error);
    res.status(500).json({ error: 'Unable to open this profile.' });
  }
});

// Compute from the batched candidate/interest data, without queries per card.
function computeCompatibility(me,them,myInterests,theirInterests){
 const shared=theirInterests.filter(interest=>myInterests.has(interest.id));
 let score=Math.min(shared.length*10,50)+20;const reasons=[];
 if(shared.length)reasons.push(`${shared.length} shared interest${shared.length>1?'s':''}`);
 if(me.age&&them.age&&Math.abs(me.age-them.age)<=5){score+=15;reasons.push('Age preference matches');}
 if(me.religion&&them.religion&&me.religion===them.religion){score+=15;reasons.push('Same religion preference');}
 reasons.push('Within preferred distance');return {score:Math.min(score,99),reasons,shared};
}

// GET /api/discover - list anonymous aura cards
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { gender, religion, age_min, age_max, interests, dating_intention } = req.query;

    if(req.query.q!==undefined && (typeof req.query.q!=='string'||req.query.q.length>80))return res.status(400).json({error:'Search must be 80 characters or fewer.'});
    const search=(req.query.q||'').trim();
    const byUsername = search.startsWith('@');
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
      SELECT u.id, u.age, u.gender, u.religion, u.city, u.username,
             a.aura_name, a.aura_color, a.vibe, a.bio, a.emoji, a.dating_intention, a.prompt_answers
      FROM users u
      JOIN auras a ON a.user_id = u.id
      WHERE u.id != ALL($1) AND ${profileVisibleSql('u.id','$2')}
    `;
    const params = [excludedIds,userId];

    const searchTerm = byUsername ? search.slice(1) : search;
    if (search && !searchTerm) return res.json([]);
    let searchParameter;
    if (searchTerm) {
      params.push(searchTerm);
      searchParameter = `LOWER($${params.length}::text)`;
      const usernameMatch = `POSITION(${searchParameter} IN u.username)>0`;
      query += byUsername ? ` AND ${usernameMatch}` : ` AND (${usernameMatch} OR POSITION(${searchParameter} IN LOWER(a.aura_name))>0)`;
    }
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

    query += searchParameter ? ` ORDER BY (u.username=${searchParameter}) DESC, LOWER(a.aura_name),u.id LIMIT 20` : ' ORDER BY RANDOM() LIMIT 20';

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
      const {score,reasons,shared}=computeCompatibility(meResult.rows[0]||{},row,myInterests,theirInterests);
      cards.push({
        id: row.id,
        aura_name: row.aura_name,
        username: row.username,
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
        shared_interests: shared.map(({name,emoji})=>({name,emoji})),
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
  const senderId=req.user.userId,receiverId=Number(req.params.userId);
  if(!Number.isInteger(receiverId)||receiverId<=0||receiverId>2147483647||senderId===receiverId)return res.status(400).json({error:'Choose another Aura.'});
  const rawOpener = req.body?.opener;
  if (rawOpener !== undefined && (typeof rawOpener !== 'string' || rawOpener.trim().length > 160 || rawOpener.includes('\0'))) {
    return res.status(400).json({ error: 'Write an opener of up to 160 characters.' });
  }
  const opener = rawOpener?.trim() || null;
  let client;
  try{
    if (opener && !await enforceText(req, res, opener)) return;
    client=await db.pool.connect();await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(68421001)');
    const profiles=await client.query('SELECT user_id FROM auras WHERE user_id IN($1,$2)',[senderId,receiverId]);
    if(profiles.rowCount!==2){await client.query('ROLLBACK');return res.status(404).json({error:'Both people need an Aura profile before sending interest.'});}
    const visible=await client.query('SELECT '+profileVisibleSql('$1::integer','$2::integer')+' AS allowed',[receiverId,senderId]);
    if(!visible.rows[0]?.allowed){await client.query('ROLLBACK');return res.status(404).json({error:'Aura not found.'});}
    const sent = await client.query('INSERT INTO likes(sender_id,receiver_id,opener) VALUES($1,$2,$3) ON CONFLICT(sender_id,receiver_id) DO NOTHING RETURNING id',[senderId,receiverId,opener]);
    let match=await client.query('SELECT id,soul_game_completed FROM matches WHERE (user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1) ORDER BY id LIMIT 1',[senderId,receiverId]);
    const mutual=await client.query('SELECT id FROM likes WHERE sender_id=$1 AND receiver_id=$2',[receiverId,senderId]);
    if (mutual.rowCount) {
      if (!match.rowCount) {
        match = await client.query(
          'INSERT INTO matches(user1_id,user2_id,soul_game_completed) VALUES($1,$2,TRUE) RETURNING id,soul_game_completed',
          [senderId, receiverId]
        );
      } else if (!match.rows[0].soul_game_completed) {
        match = await client.query(
          'UPDATE matches SET soul_game_completed=TRUE WHERE id=$1 RETURNING id,soul_game_completed',
          [match.rows[0].id]
        );
      }
    }
    await client.query('COMMIT');
    res.json({message:match.rowCount?'Your Auras matched!':'Aura sent. They can see it in Discover → Received Auras.',matched:!!match.rowCount,matchId:match.rows[0]?.id||null,canChat:!!match.rows[0]?.soul_game_completed});
    if (sent.rowCount && (!match.rowCount || opener)) {
      require('../messageAlerts').notifyActivity(req.app.get('io'), receiverId, senderId, {
        path: '/discover?aura=' + sent.rows[0].id, body: 'Someone sent you an Aura.',
      }).catch(error => console.error('Aura alert failed:', error.code || error.name));
    }
  }catch(error){if(client)await client.query('ROLLBACK');console.error('Send Aura error:',error.code||error.name);res.status(500).json({error:'Unable to send Aura.'});}
  finally{client?.release();}
});
module.exports = router;
