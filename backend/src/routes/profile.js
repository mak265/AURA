const {enforceText}=require('../textModeration');
const {enforceImage}=require('../imageModeration');
const { presenceHeartbeat } = require('../presence');
const { validateConnectionProfile, saveConnectionProfile } = require('../connectionProfile');
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.post('/presence',authenticate,presenceHeartbeat);

// GET /api/profile - own profile with aura + private identity + stats
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;

    const userResult = await db.query(
      'SELECT id, email, real_name, age, gender, religion, city, settings, profile_photo FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const auraResult = await db.query('SELECT * FROM auras WHERE user_id = $1', [userId]);
    const interestsResult = await db.query(
      `SELECT i.name, i.emoji FROM interests i
       JOIN user_interests ui ON ui.interest_id = i.id
       WHERE ui.user_id = $1`,
      [userId]
    );

    // Stats
    const matchesCount = await db.query(
      'SELECT count(*) FROM matches WHERE user1_id = $1 OR user2_id = $1',
      [userId]
    );
    const revealedCount = await db.query(
      'SELECT count(*) FROM matches WHERE (user1_id = $1 OR user2_id = $1) AND revealed = TRUE',
      [userId]
    );
    const aurasSentCount = await db.query(
      'SELECT count(*) FROM likes WHERE sender_id = $1',
      [userId]
    );

    res.json({
      user: userResult.rows[0],
      aura: auraResult.rows[0] || null,
      interests: interestsResult.rows,
      stats: {
        matches: parseInt(matchesCount.rows[0].count),
        revealed: parseInt(revealedCount.rows[0].count),
        aurasSent: parseInt(aurasSentCount.rows[0].count),
      },
    });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Only return posts belonging to the authenticated profile owner.
router.get('/posts', authenticate, async (req, res) => {
  try {
    const result = await db.query(`SELECT p.id,p.image_url,p.caption,p.created_at,p.visibility,
      (SELECT count(*)::int FROM post_likes WHERE post_id=p.id) AS like_count,
      (SELECT count(*)::int FROM post_comments WHERE post_id=p.id) AS comment_count
      FROM posts p WHERE p.user_id=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT 50`, [req.user.userId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Profile posts error:',error);
    res.status(500).json({ error: 'Unable to load your posts.' });
  }
});

router.put('/photo', authenticate, async (req,res)=>{
  const photo=req.body?.photo;
  if(photo!==null){
    if(typeof photo!=='string'||photo.length>2800000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo))return res.status(400).json({error:'Choose a JPEG, PNG or WebP photo under 2 MB.'});
    const [header,data]=photo.split(',');const bytes=Buffer.from(data,'base64');
    const valid=header.includes('jpeg')?bytes[0]===255&&bytes[1]===216:header.includes('png')?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(!valid||bytes.length>2*1024*1024)return res.status(400).json({error:'Choose a valid photo under 2 MB.'});
  }
  try{
    if(photo!==null&&!await enforceText(req,res,''))return;
    if(photo!==null&&!await enforceImage(req,res,photo))return;
    await db.query('UPDATE users SET profile_photo=$1,updated_at=NOW() WHERE id=$2',[photo,req.user.userId]);
    res.json({profile_photo:photo});
  }catch(error){console.error(error);res.status(500).json({error:'Unable to update profile photo.'});}
});

// PUT /api/profile - update aura and about-you
router.put('/', authenticate, async (req, res) => {
  try {
    const error = validateConnectionProfile(req.body);
    if (error) return res.status(400).json({ error });
    const userId = req.user.userId;
    const { aura_name, aura_color, vibe, bio, emoji, age, gender, religion, city, real_name, interests } = req.body;

    if(!await enforceText(req,res,[aura_name,bio,vibe,...(req.body.prompt_answers||[])].join(' ')))return;
    if (aura_name) {
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
    }

    await db.query(
      `UPDATE users SET age = COALESCE($1, age), gender = COALESCE($2, gender),
       religion = COALESCE($3, religion), city = COALESCE($4, city),
       real_name = COALESCE($5, real_name), updated_at = NOW()
       WHERE id = $6`,
      [age || null, gender || null, religion || null, city || null, real_name || null, userId]
    );

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
    res.json({ message: 'Profile updated successfully.' });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// PUT /api/profile/settings - privacy settings
router.put('/settings', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const settings = req.body;
    const allowed = ['hide_online','hide_last_active','incognito','private_dating'];
    if (!settings || Array.isArray(settings) || Object.entries(settings).some(([key,value])=>!allowed.includes(key)||typeof value!=='boolean')) {
      return res.status(400).json({error:'Provide valid privacy settings.'});
    }

    await db.query(
      `UPDATE users SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(settings), userId]
    );

    res.json({ message: 'Settings updated successfully.' });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

router.get('/blocked',authenticate,async(req,res)=>{try{const result=await db.query('SELECT b.blocked_id AS id,a.aura_name FROM blocks b LEFT JOIN auras a ON a.user_id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY b.id DESC',[req.user.userId]);res.json(result.rows);}catch{res.status(500).json({error:'Unable to load blocked users.'});}});
router.delete('/blocked/:id',authenticate,async(req,res)=>{try{await db.query('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2',[req.user.userId,Number(req.params.id)]);res.json({ok:true});}catch{res.status(500).json({error:'Unable to unblock user.'});}});
// POST /api/profile/block
router.post('/block', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { blockedId } = req.body;

    await db.query(
      'INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, blockedId]
    );

    res.json({ message: 'User blocked.' });
  } catch (err) {
    console.error('Block error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/profile/report
router.post('/report', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { reportedId, reason, details } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Reason is required.' });
    }

    await db.query(
      'INSERT INTO reports (reporter_id, reported_id, reason, details) VALUES ($1, $2, $3, $4)',
      [userId, reportedId, reason, details || null]
    );

    res.json({ message: 'Report submitted. Thank you for keeping AURA safe.' });
  } catch (err) {
    console.error('Report error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;

