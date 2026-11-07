const { enforceImage } = require('../imageModeration');
const { enforceText } = require('../textModeration');
const { profileVisibleSql } = require('../profileVisibility');
const { visiblePostSql, canViewPost } = require('../postPrivacy');
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.param('postId', async (req,res,next,value) => {
  try {
    if (!Number.isInteger(Number(value)) || !await canViewPost(Number(value),req.user.userId)) return res.status(404).json({error:'Post not found.'});
    next();
  } catch (error) { next(error); }
});
router.param('commentId', async (req,res,next,value) => {
  try {
    if (!Number.isInteger(Number(value))) return res.status(404).json({error:'Comment not found.'});
    const comment = await db.query('SELECT post_id FROM post_comments WHERE id=$1',[Number(value)]);
    if (!comment.rowCount || !await canViewPost(comment.rows[0].post_id,req.user.userId)) return res.status(404).json({error:'Comment not found.'});
    next();
  } catch (error) { next(error); }
});

router.delete('/:postId',async(req,res)=>{
  try{
    const result=await db.query('DELETE FROM posts WHERE id=$1 AND user_id=$2 RETURNING id',[Number(req.params.postId),req.user.userId]);
    if(!result.rowCount)return res.status(403).json({error:'Only the author can delete this post.'});
    res.json({ok:true});
  }catch(error){console.error('Delete post error:',error);res.status(500).json({error:'Unable to delete post.'});}
});

// GET /api/feed - list all public posts (newest first)
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const scope=req.query.scope||'all';
    if(!['all','connections'].includes(scope))return res.status(400).json({error:'Invalid feed filter.'});

    const result = await db.query(`
      SELECT p.id, p.user_id, p.image_url, p.caption, p.created_at, p.visibility,
             CASE WHEN p.user_id=$1 OR EXISTS(SELECT 1 FROM matches photo_match WHERE photo_match.revealed=TRUE AND ((photo_match.user1_id=$1 AND photo_match.user2_id=p.user_id) OR (photo_match.user2_id=$1 AND photo_match.user1_id=p.user_id))) THEN u.profile_photo ELSE NULL END AS profile_photo,
             a.aura_name, a.aura_color, a.emoji,
             (SELECT id FROM matches WHERE (user1_id=$1 AND user2_id=p.user_id) OR (user2_id=$1 AND user1_id=p.user_id) ORDER BY id LIMIT 1) AS match_id,
             (SELECT soul_game_completed FROM matches WHERE (user1_id=$1 AND user2_id=p.user_id) OR (user2_id=$1 AND user1_id=p.user_id) ORDER BY id LIMIT 1) AS can_chat,
             (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) AS like_count,
             (SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) AS comment_count,
             (SELECT reaction FROM post_likes WHERE post_id = p.id AND user_id = $1) AS my_reaction,
             COALESCE((
               SELECT jsonb_object_agg(reaction, cnt) FROM (
                 SELECT reaction, COUNT(*)::int AS cnt
                 FROM post_likes WHERE post_id = p.id GROUP BY reaction
               ) rc
             ), '{}'::jsonb) AS reaction_counts
      FROM posts p
      LEFT JOIN auras a ON a.user_id = p.user_id
      LEFT JOIN users u ON u.id=p.user_id
      WHERE ${visiblePostSql()} AND ($2::text='all' OR (p.user_id!=$1 AND EXISTS(SELECT 1 FROM matches connection WHERE (connection.user1_id=$1 AND connection.user2_id=p.user_id) OR (connection.user2_id=$1 AND connection.user1_id=p.user_id))))
      ORDER BY p.created_at DESC
      LIMIT 50
    `, [userId,scope]);

    res.json(result.rows);
  } catch (err) {
    console.error('Feed error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/feed - create a new post
router.post('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { image_url, caption, visibility = 'public' } = req.body;
    if (!['public','connections','private'].includes(visibility)) return res.status(400).json({error: 'Choose a valid audience.'});

    const hasImage = !!image_url;
    const hasText = !!(caption && caption.trim());

    if (!hasImage && !hasText) {
      return res.status(400).json({ error: 'Post must have an image or some text.' });
    }

    if(!await enforceText(req,res,caption))return;
    if(!await enforceImage(req,res,image_url))return;
    const result = await db.query(
      'INSERT INTO posts (user_id, image_url, caption, visibility) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, image_url || null, caption || '', visibility]
    );

    const post = result.rows[0];
    const aura = await db.query('SELECT aura_name, aura_color, emoji FROM auras WHERE user_id = $1', [userId]);
    post.aura_name = aura.rows[0]?.aura_name || 'Anonymous';
    post.aura_color = aura.rows[0]?.aura_color || 'violet';
    post.emoji = aura.rows[0]?.emoji || '🌌';
    post.like_count = 0;
    post.comment_count = 0;
    post.liked_by_me = false;

    res.status(201).json(post);
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

router.patch('/:postId/privacy', authenticate, async (req,res) => {
  if (!['public','connections','private'].includes(req.body?.visibility)) return res.status(400).json({error:'Choose a valid audience.'});
  try {
    const result = await db.query('UPDATE posts SET visibility=$1 WHERE id=$2 AND user_id=$3 RETURNING id,visibility',[req.body.visibility,Number(req.params.postId),req.user.userId]);
    if (!result.rowCount) return res.status(403).json({error:'Only the author can change the audience.'});
    res.json(result.rows[0]);
  } catch(error) { res.status(500).json({error:'Unable to update audience.'}); }
});
router.get('/:postId/reactions', authenticate, async(req,res) => {
  try {
    const result = await db.query(`SELECT l.user_id,l.reaction,CASE WHEN ${profileVisibleSql('l.user_id','$2')} THEN a.aura_name ELSE 'Private member' END AS aura_name,CASE WHEN ${profileVisibleSql('l.user_id','$2')} THEN a.emoji ELSE NULL END AS emoji FROM post_likes l
      LEFT JOIN auras a ON a.user_id=l.user_id WHERE l.post_id=$1 ORDER BY l.id`,[Number(req.params.postId),req.user.userId]);
    res.json(result.rows);
  } catch(error) { res.status(500).json({error:'Unable to load reactions.'}); }
});

// POST /api/feed/:postId/like - toggle/change a reaction on a post
router.post('/:postId/like', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const postId = parseInt(req.params.postId);
    const reaction = (req.body && req.body.reaction) || 'like';

    // Check if post exists
    const post = await db.query('SELECT id FROM posts WHERE id = $1', [postId]);
    if (post.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    // Check if user already reacted
    const existing = await db.query(
      'SELECT reaction FROM post_likes WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    );

    if (existing.rows.length > 0) {
      if (existing.rows[0].reaction === reaction) {
        // Same reaction -> remove it
        await db.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
        return res.json({ liked: false, reaction: null });
      }
      // Different reaction -> switch it
      await db.query(
        'UPDATE post_likes SET reaction = $3 WHERE post_id = $1 AND user_id = $2',
        [postId, userId, reaction]
      );
      return res.json({ liked: true, reaction });
    }

    // New reaction
    await db.query(
      'INSERT INTO post_likes (post_id, user_id, reaction) VALUES ($1, $2, $3)',
      [postId, userId, reaction]
    );
    res.json({ liked: true, reaction });
  } catch (err) {
    console.error('Reaction error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/feed/:postId/comments - get comments for a post (with reactions)
router.get('/:postId/comments', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const postId = parseInt(req.params.postId);

    const result = await db.query(`
      SELECT c.id, c.text, c.created_at, c.user_id, c.parent_id,
             CASE WHEN ${profileVisibleSql('c.user_id','$2')} THEN a.aura_name ELSE 'Private member' END AS aura_name,
             CASE WHEN ${profileVisibleSql('c.user_id','$2')} THEN a.aura_color ELSE NULL END AS aura_color,
             CASE WHEN ${profileVisibleSql('c.user_id','$2')} THEN a.emoji ELSE NULL END AS emoji,
             (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) AS like_count,
             (SELECT reaction FROM comment_likes WHERE comment_id = c.id AND user_id = $2) AS my_reaction,
             COALESCE((
               SELECT jsonb_object_agg(reaction, cnt) FROM (
                 SELECT reaction, COUNT(*)::int AS cnt
                 FROM comment_likes WHERE comment_id = c.id GROUP BY reaction
               ) rc
             ), '{}'::jsonb) AS reaction_counts
      FROM post_comments c
      LEFT JOIN auras a ON a.user_id = c.user_id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC
    `, [postId, userId]);

    res.json(result.rows);
  } catch (err) {
    console.error('Get comments error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/feed/:postId/comments - add a comment (or reply)
router.post('/:postId/comments', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const postId = parseInt(req.params.postId);
    const { text, parent_id } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Comment text is required.' });
    }

    const post = await db.query('SELECT id FROM posts WHERE id = $1', [postId]);
    if (post.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    if (parent_id) {
      const parent = await db.query(
        'SELECT id FROM post_comments WHERE id = $1 AND post_id = $2',
        [parent_id, postId]
      );
      if (parent.rows.length === 0) {
        return res.status(404).json({ error: 'Parent comment not found.' });
      }
    }

    if(!await enforceText(req,res,text))return;
    const result = await db.query(
      'INSERT INTO post_comments (post_id, user_id, parent_id, text) VALUES ($1, $2, $3, $4) RETURNING *',
      [postId, userId, parent_id || null, text.trim()]
    );

    const comment = result.rows[0];
    const aura = await db.query('SELECT aura_name, aura_color, emoji FROM auras WHERE user_id = $1', [userId]);
    comment.aura_name = aura.rows[0]?.aura_name || 'Anonymous';
    comment.aura_color = aura.rows[0]?.aura_color || 'violet';
    comment.emoji = aura.rows[0]?.emoji || '🌌';
    comment.like_count = 0;
    comment.my_reaction = null;
    comment.reaction_counts = {};

    res.status(201).json(comment);
  } catch (err) {
    console.error('Add comment error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/feed/comments/:commentId/like - react to a comment
router.post('/comments/:commentId/like', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const commentId = parseInt(req.params.commentId);
    const reaction = (req.body && req.body.reaction) || 'like';

    const comment = await db.query('SELECT id FROM post_comments WHERE id = $1', [commentId]);
    if (comment.rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found.' });
    }

    const existing = await db.query(
      'SELECT reaction FROM comment_likes WHERE comment_id = $1 AND user_id = $2',
      [commentId, userId]
    );

    if (existing.rows.length > 0) {
      if (existing.rows[0].reaction === reaction) {
        await db.query('DELETE FROM comment_likes WHERE comment_id = $1 AND user_id = $2', [commentId, userId]);
        return res.json({ liked: false, reaction: null });
      }
      await db.query(
        'UPDATE comment_likes SET reaction = $3 WHERE comment_id = $1 AND user_id = $2',
        [commentId, userId, reaction]
      );
      return res.json({ liked: true, reaction });
    }

    await db.query(
      'INSERT INTO comment_likes (comment_id, user_id, reaction) VALUES ($1, $2, $3)',
      [commentId, userId, reaction]
    );
    res.json({ liked: true, reaction });
  } catch (err) {
    console.error('Comment reaction error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
