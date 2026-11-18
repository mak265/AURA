const { enforceImage } = require('../imageModeration');
const { enforceText } = require('../textModeration');
const { profileVisibleSql } = require('../profileVisibility');
const { visiblePostSql, canViewPost } = require('../postPrivacy');
const { postIdentityFields } = require('../postIdentity');
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { notifyActivity } = require('../messageAlerts');

const router = express.Router();
async function notifyPostActivity(req, recipientId, postId, body, comments = false) {
  const senderId = req.user.userId;
  if (recipientId === senderId) return;
  try {
    if (!await canViewPost(postId, recipientId)) return;
    await db.query(`INSERT INTO journal_activity (recipient_id, actor_id, post_id, body, opens_comments)
      VALUES ($1, $2, $3, $4, $5)`, [recipientId, senderId, postId, body, comments]);
    notifyActivity(req.app.get('io'), recipientId, senderId, {
      path: `/feed?post=${postId}${comments ? '&comments=1' : ''}`, body
    }).catch(error => console.error('Journal push failed:', error.code || error.name));
  } catch (error) {
    console.error('Journal notification failed:', error.code || error.name);
  }
}
router.use(authenticate);
router.get('/activity', async (req, res, next) => {
  try {
    const result = await db.query(`SELECT n.id, n.post_id, n.body, n.opens_comments, n.created_at, n.read_at,
      count(*) FILTER (WHERE n.read_at IS NULL) OVER ()::int AS unread,
      CASE WHEN ${profileVisibleSql('n.actor_id', '$1')} THEN a.aura_name END AS actor_name
      FROM journal_activity n JOIN posts p ON p.id=n.post_id LEFT JOIN auras a ON a.user_id=n.actor_id
      WHERE n.recipient_id=$1 AND ${visiblePostSql('p', '$1')}
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=n.actor_id)
          OR (b.blocked_id=$1 AND b.blocker_id=n.actor_id))
      ORDER BY n.id DESC LIMIT 50`, [req.user.userId]);
    res.json({ items: result.rows, unread: result.rows[0]?.unread ?? 0 });
  } catch (error) { next(error); }
});

router.patch('/activity/read', async (req, res, next) => {
  const { id } = req.body;
  if (id !== undefined && (!Number.isInteger(id) || id < 1 || id > 2147483647)) {
    return res.status(400).json({ error: 'Invalid notification.' });
  }
  try {
    await db.query(`UPDATE journal_activity SET read_at=now()
      WHERE recipient_id=$1 AND read_at IS NULL AND ($2::int IS NULL OR id=$2)`, [req.user.userId, id ?? null]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});
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
    if(!['all','connections','saved'].includes(scope))return res.status(400).json({error:'Invalid feed filter.'});
    const before = req.query.before === undefined ? null : Number(req.query.before);
    if (before !== null && (scope !== 'saved' || typeof req.query.before !== 'string' || !Number.isInteger(before) || before < 1 || before > 2147483647)) {
      return res.status(400).json({ error: 'Invalid saved posts page.' });
    }
    const postId = req.query.post === undefined ? null : Number(req.query.post);
    if (postId !== null && (typeof req.query.post !== 'string' || !Number.isInteger(postId) || postId < 1 || postId > 2147483647)) {
      return res.status(400).json({ error: 'Invalid post.' });
    }

    const result = await db.query(`
      SELECT p.id, p.user_id, p.image_url, p.caption, p.created_at, p.edited_at, p.visibility,
             ${postIdentityFields}, a.aura_color, a.emoji,
             bookmark.id IS NOT NULL AS saved_by_me, bookmark.id AS save_cursor,
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
      LEFT JOIN post_bookmarks bookmark ON bookmark.post_id=p.id AND bookmark.user_id=$1
      WHERE ${visiblePostSql()} AND ($3::int IS NULL OR p.id=$3)
        AND ($2::text!='connections' OR (p.user_id!=$1 AND EXISTS(SELECT 1 FROM matches connection WHERE (connection.user1_id=$1 AND connection.user2_id=p.user_id) OR (connection.user2_id=$1 AND connection.user1_id=p.user_id))))
        AND ($2!='saved' OR (bookmark.id IS NOT NULL AND ($4::int IS NULL OR bookmark.id<$4)))
      ORDER BY CASE WHEN $2='saved' THEN bookmark.id END DESC, p.created_at DESC, p.id DESC
      LIMIT 50
    `, [userId,scope,postId,before]);

    res.set('Cache-Control', 'no-store');
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
    const { image_url, caption, visibility = 'public', identity_mode = 'aura' } = req.body;
    if (!['public','connections','private'].includes(visibility)) return res.status(400).json({error: 'Choose a valid audience.'});
    if (!['aura', 'profile'].includes(identity_mode)) return res.status(400).json({ error: 'Choose a valid posting identity.' });

    const hasImage = !!image_url;
    const hasText = !!(caption && caption.trim());

    if (!hasImage && !hasText) {
      return res.status(400).json({ error: 'Post must have an image or some text.' });
    }

    if(!await enforceText(req,res,caption))return;
    if(!await enforceImage(req,res,image_url))return;
    const { rows: [post] } = await db.query(`WITH published AS (
      INSERT INTO posts (user_id, image_url, caption, visibility, identity_mode)
      SELECT id, $2, $3, $4, $5 FROM users WHERE id=$1
        AND ($5='aura' OR NULLIF(BTRIM(real_name), '') IS NOT NULL)
      RETURNING id, user_id, image_url, caption, visibility, identity_mode, created_at
    ) SELECT p.id, p.user_id, p.image_url, p.caption, p.visibility, p.created_at, ${postIdentityFields},
      a.aura_color, a.emoji
    FROM published p JOIN users u ON u.id=p.user_id LEFT JOIN auras a ON a.user_id=p.user_id`,
    [userId, image_url || null, caption || '', visibility, identity_mode]);
    if (!post) return res.status(409).json({ error: 'Add your real name in You → Edit profile before posting as your real profile.' });
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
    const postId = Number(req.params.postId), userId = req.user.userId;
    const result = await db.query(`UPDATE posts SET visibility=$1 WHERE id=$2 AND user_id=$3
      AND (identity_mode='aura' OR $4::bool OR array_position(ARRAY['private','connections','public'], $1)
        <= array_position(ARRAY['private','connections','public'], visibility)) RETURNING id,visibility`,
    [req.body.visibility, postId, userId, req.body.confirm_profile_visibility === true]);
    if (!result.rowCount) {
      const own = await db.query('SELECT 1 FROM posts WHERE id=$1 AND user_id=$2', [postId, userId]);
      if (own.rowCount) return res.status(409).json({ error: 'Confirm who will be able to see your real profile on this post.' });
      return res.status(403).json({error:'Only the author can change the audience.'});
    }
    res.json(result.rows[0]);
  } catch(error) { res.status(500).json({error:'Unable to update audience.'}); }
});

router.patch('/:postId', async (req, res, next) => {
  const { caption } = req.body || {};
  if (typeof caption !== 'string' || caption.length > 5000) {
    return res.status(400).json({ error: 'Enter a caption of up to 5,000 characters.' });
  }
  const postId = Number(req.params.postId);
  const userId = req.user.userId;
  const trimmed = caption.trim();
  try {
    const { rows: [post] } = await db.query('SELECT user_id, image_url FROM posts WHERE id=$1', [postId]);
    if (!post || post.user_id !== userId) return res.status(403).json({ error: 'Only the author can edit this post.' });
    if (!trimmed && !post.image_url) return res.status(400).json({ error: 'A text post needs a caption.' });
    if (!await enforceText(req, res, trimmed)) return;

    const { rows: [updated] } = await db.query(`UPDATE posts
      SET caption=$3, edited_at=CASE WHEN caption IS DISTINCT FROM $3 THEN NOW() ELSE edited_at END
      WHERE id=$1 AND user_id=$2 AND moderation_hidden_at IS NULL RETURNING id, caption, edited_at`, [postId, userId, trimmed]);
    if (!updated) return res.status(404).json({ error: 'Post not found.' });
    res.json(updated);
  } catch (error) { next(error); }
});

router.put('/:postId/save', async (req, res, next) => {
  try {
    const { rowCount } = await db.query(`INSERT INTO post_bookmarks (user_id, post_id)
      SELECT $1, p.id FROM posts p WHERE p.id=$2 AND ${visiblePostSql()}
      ON CONFLICT (user_id, post_id) DO UPDATE SET post_id=EXCLUDED.post_id`, [req.user.userId, Number(req.params.postId)]);
    if (!rowCount) return res.status(404).json({ error: 'Post not found.' });
    res.json({ saved_by_me: true });
  } catch (error) { next(error); }
});

router.delete('/:savedPostId/save', async (req, res, next) => {
  const postId = Number(req.params.savedPostId);
  if (!Number.isInteger(postId) || postId < 1 || postId > 2147483647) return res.status(404).json({ error: 'Post not found.' });
  try {
    await db.query('DELETE FROM post_bookmarks WHERE user_id=$1 AND post_id=$2', [req.user.userId, postId]);
    res.json({ saved_by_me: false });
  } catch (error) { next(error); }
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
    const post = await db.query('SELECT user_id FROM posts WHERE id = $1', [postId]);
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
    await notifyPostActivity(req, post.rows[0].user_id, postId, 'Someone reacted to your post.');
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

    const post = await db.query('SELECT user_id FROM posts WHERE id = $1', [postId]);
    if (post.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    let parentAuthor;
    if (parent_id) {
      const parent = await db.query(
        'SELECT user_id FROM post_comments WHERE id = $1 AND post_id = $2',
        [parent_id, postId]
      );
      if (parent.rows.length === 0) {
        return res.status(404).json({ error: 'Parent comment not found.' });
      }
      parentAuthor = parent.rows[0].user_id;
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

    if (parentAuthor) await notifyPostActivity(req, parentAuthor, postId, 'Someone replied to your comment.', true);
    if (post.rows[0].user_id !== parentAuthor) {
      await notifyPostActivity(req, post.rows[0].user_id, postId, 'Someone commented on your post.', true);
    }
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

    const comment = await db.query('SELECT user_id, post_id FROM post_comments WHERE id = $1', [commentId]);
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
    await notifyPostActivity(req, comment.rows[0].user_id, comment.rows[0].post_id, 'Someone reacted to your comment.', true);
    res.json({ liked: true, reaction });
  } catch (err) {
    console.error('Comment reaction error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
