import ReportButton from '../components/ReportButton';
import ContentSkeleton from '../components/ContentSkeleton';
import Glimpses from '../components/Glimpses';
import DeletePostButton from '../components/DeletePostButton';
import ReactionSummary from '../components/ReactionSummary';
import Avatar from '../components/Avatar';
import ReactionList from '../components/ReactionList';
import ReactionButton from '../components/ReactionButton';
import AuraRequestButton from '../components/AuraRequestButton';
import PostAudience from '../components/PostAudience';
import PostIdentity from '../components/PostIdentity';
import PostImage from '../components/PostImage';
import PostPrompts from '../components/PostPrompts';
import { EditPostButton, SavePostButton } from '../components/PostActions';
import Icon from '../components/Icon';
import AppTopBar from '../components/AppTopBar';
import { prepareJournalPhoto } from '../photoUpload';
import { useState, useEffect, useEffectEvent, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Feed() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const targetPost = searchParams.get('post');
  const targetGlimpse = Number(searchParams.get('glimpse'));
  const targetComments = searchParams.get('comments') === '1';
  const openedTarget = useRef(null);
  const feedRequest=useRef(0);
  const [feedTab,setFeedTab]=useState('all');
  const [reactionsPost,setReactionsPost]=useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating,setCreating]=useState(false);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [audience,setAudience] = useState('public');
  const [identityMode, setIdentityMode] = useState('aura');
  const [caption, setCaption] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const captionInputRef = useRef(null);

  // Comments modal state
  const [commentsPost, setCommentsPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentReactionError, setCommentReactionError] = useState('');
  const pendingCommentReactions = useRef(new Set());
  const [commentInput, setCommentInput] = useState('');
  const [replyTo, setReplyTo] = useState(null); // { id, name }
  const [replyText, setReplyText] = useState('');
  const commentsEndRef = useRef(null);

  // Post reaction picker state

  useEffect(() => {
    fetchPosts();
    return()=>{feedRequest.current++;};
  }, [feedTab, targetPost]);

  useEffect(() => {
    setCommentsPost(null);
  }, [targetPost]);

  async function fetchPosts() {
    const request=++feedRequest.current;
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/feed',{params:targetPost ? { post: targetPost } : { scope:feedTab }});
      if(request!==feedRequest.current)return;
      // Coerce Postgres numeric strings to numbers so counts increment correctly
      setPosts(res.data.map(p => ({
        ...p,
        like_count: Number(p.like_count) || 0,
        comment_count: Number(p.comment_count) || 0,
        reaction_counts: Object.fromEntries(
          Object.entries(p.reaction_counts || {}).map(([k, v]) => [k, Number(v) || 0])
        ),
      })));
    } catch (err) {
      if(request===feedRequest.current)setError(err.response?.data?.error || 'Failed to load feed.');
    } finally {
      if(request===feedRequest.current)setLoading(false);
    }
  };

  const handleFileUpload = async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setPreparingPhoto(true);
    setPhotoError('');
    try {
      setImageUrl(await prepareJournalPhoto(file));
    } catch {
      setPhotoError('Unable to prepare that photo. Try a JPEG, PNG, or WebP image.');
    } finally {
      setPreparingPhoto(false);
    }
  };

  const createPost = async () => {
    if(creating || preparingPhoto)return;
    setPhotoError('');
    if (!imageUrl && !caption.trim()) {
      setPhotoError('Please add an image or write something.');
      return;
    }
    try {
      setCreating(true);
      await api.post('/feed', { image_url: imageUrl || null, caption, visibility:audience, identity_mode: identityMode });
      setImageUrl('');
      setCaption('');
      setIdentityMode('aura');
      setShowCreate(false);
      fetchPosts();
    } catch (err) {
      setPhotoError(err.response?.data?.error || 'Failed to create post. Please try again.');
    } finally {setCreating(false);}
  };

  const changeAudience = async (postId,visibility,confirmed) => {
    try {
      await api.patch(`/feed/${postId}/privacy`,{visibility,confirm_profile_visibility: confirmed === true});
      setPosts(previous=>previous.map(post=>post.id===postId?{...post,visibility}:post));
    } catch(err){setError(err.response?.data?.error || 'Unable to update audience.');}
  };
  // ---- Reactions ----
  const updatePost = (id, changes) => {
    setPosts(previous => previous.map(post => post.id === id ? { ...post, ...changes } : post));
  };
  const applyReaction = async (postId, reaction) => {
    try {
      const res = await api.post(`/feed/${postId}/like`, { reaction });
      setPosts(prev => prev.map(p => {
        if (p.id !== postId) return p;
        const counts = { ...(p.reaction_counts || {}) };
        const prevReaction = p.my_reaction;
        let likeCount = p.like_count || 0;

        // remove previous reaction
        if (prevReaction) {
          if (counts[prevReaction] !== undefined) {
            counts[prevReaction] = Math.max(0, counts[prevReaction] - 1);
            if (counts[prevReaction] === 0) delete counts[prevReaction];
          }
          likeCount = Math.max(0, likeCount - 1);
        }

        const myReaction = res.data.reaction;
        if (myReaction) {
          counts[myReaction] = (counts[myReaction] || 0) + 1;
          likeCount += 1;
        }

        return { ...p, reaction_counts: counts, like_count: likeCount, my_reaction: myReaction };
      }));
    } catch (err) {
      console.error(err);
    }
  };

  // ---- Comments ----
  const normalizeComment = (c) => ({
    ...c,
    like_count: Number(c.like_count) || 0,
    reaction_counts: Object.fromEntries(
      Object.entries(c.reaction_counts || {}).map(([k, v]) => [k, Number(v) || 0])
    ),
  });

  const openComments = async (post) => {
    setCommentReactionError('');
    setCommentsPost(post);
    setCommentInput('');
    setReplyTo(null);
    setReplyText('');
    setComments([]);
    setCommentsLoading(true);
    try {
      const res = await api.get(`/feed/${post.id}/comments`);
      setComments(res.data.map(normalizeComment));
    } catch (err) {
      console.error(err);
    } finally {
      setCommentsLoading(false);
    }
  };

  const openTargetComments = useEffectEvent(post => openComments(post));
  useEffect(() => {
    if (!targetComments) {
      openedTarget.current = null;
      return;
    }
    const post = posts.find(post => String(post.id) === targetPost);
    if (!post || loading || openedTarget.current === targetPost) return;
    openedTarget.current = targetPost;
    openTargetComments(post);
  }, [posts, loading, targetPost, targetComments]);

  const closeComments = () => {
    if (targetComments) {
      setSearchParams({ post: targetPost }, { replace: true });
    }
    setCommentsPost(null);
    setComments([]);
    setReplyTo(null);
    setReplyText('');
  };

  const addComment = async () => {
    if (!commentsPost || !commentInput.trim()) return;
    const text = commentInput;
    setCommentInput('');
    try {
      const res = await api.post(`/feed/${commentsPost.id}/comments`, { text });
      setComments(prev => [...prev, normalizeComment(res.data)]);
      bumpCommentCount();
      scrollCommentsToEnd();
    } catch (err) {
      console.error(err);
    }
  };

  const submitReply = async () => {
    if (!commentsPost || !replyTo || !replyText.trim()) return;
    const text = replyText;
    setReplyText('');
    try {
      const res = await api.post(`/feed/${commentsPost.id}/comments`, {
        text,
        parent_id: replyTo.id,
      });
      setComments(prev => [...prev, normalizeComment(res.data)]);
      setReplyTo(null);
      bumpCommentCount();
      scrollCommentsToEnd();
    } catch (err) {
      console.error(err);
    }
  };

  const bumpCommentCount = () => {
    setPosts(prev => prev.map(p =>
      p.id === commentsPost.id ? { ...p, comment_count: (p.comment_count || 0) + 1 } : p
    ));
  };

  const scrollCommentsToEnd = () => {
    setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  // ---- Comment reactions ----
  const applyCommentReaction = async (commentId, reaction) => {
    if (pendingCommentReactions.current.has(commentId)) return;
    pendingCommentReactions.current.add(commentId);
    setCommentReactionError('');
    try {
      const res = await api.post(`/feed/comments/${commentId}/like`, { reaction });
      setComments(prev => prev.map(c => {
        if (c.id !== commentId) return c;
        const counts = { ...(c.reaction_counts || {}) };
        const prevReaction = c.my_reaction;
        let likeCount = Number(c.like_count) || 0;

        if (prevReaction) {
          if (counts[prevReaction] !== undefined) {
            counts[prevReaction] = Math.max(0, counts[prevReaction] - 1);
            if (counts[prevReaction] === 0) delete counts[prevReaction];
          }
          likeCount = Math.max(0, likeCount - 1);
        }

        const myReaction = res.data.reaction;
        if (myReaction) {
          counts[myReaction] = (counts[myReaction] || 0) + 1;
          likeCount += 1;
        }

        return { ...c, reaction_counts: counts, like_count: likeCount, my_reaction: myReaction };
      }));
    } catch (err) {
      setCommentReactionError(err.response?.data?.error || 'Could not update the reaction. Try again.');
    } finally {
      pendingCommentReactions.current.delete(commentId);
    }
  };

  // ---- Comment tree helpers ----
  const commentsById = {};
  comments.forEach(c => { commentsById[c.id] = c; });
  const topLevelComments = comments.filter(c => !c.parent_id);
  const childrenOf = (id) => comments.filter(c => c.parent_id === id);

  const renderCommentRow = (c, isReply) => {
    const parent = isReply ? commentsById[c.parent_id] : null;
    return (
      <div key={c.id} className="flex gap-2.5">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0" style={{ background: c.aura_color || '#444' }}>
          {c.aura_name?.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="bg-aura-elevated rounded-2xl px-3 py-2">
            <div className="text-xs font-bold mb-0.5">{c.aura_name}</div>
            {isReply && parent && (
              <div className="text-[11px] text-aura-violet-light mb-0.5">replying to @{parent.aura_name}</div>
            )}
            <div className="text-sm text-gray-200 break-words">{c.text}</div>
          </div>

          <div className="flex items-center gap-3 mt-1 ml-1">
            <span className="text-[10px] text-gray-500">{formatTime(c.created_at)}</span>

            <ReactionButton reaction={c.my_reaction} commentCount={Number(c.like_count) || 0}
              onReact={reaction => applyCommentReaction(c.id, reaction)}/>

            <button
              onClick={() => { setReplyTo({ id: c.id, name: c.aura_name }); setReplyText(''); }}
              className="text-[11px] font-semibold text-gray-400"
            >
              Reply
            </button>
          </div>

          {replyTo && replyTo.id === c.id && (
            <div className="flex gap-2 mt-2">
              <input
                autoFocus
                className="aura-input flex-1 text-sm"
                placeholder={`Reply to ${c.aura_name}...`}
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitReply()}
              />
              <button onClick={submitReply} className="px-3 rounded-lg bg-aura-violet text-white text-sm font-bold">Send</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderRepliesFlat = (parentId) =>
    childrenOf(parentId).flatMap(child => [
      renderCommentRow(child, true),
      ...renderRepliesFlat(child.id),
    ]);

  const visiblePosts=posts;

  return (
    <div className="mobile-tab-screen journal-screen min-h-screen bg-aura-deep pb-24">
      <AppTopBar title="Journal">
        <button onClick={()=>setShowCreate(true)} className="mobile-icon-action mobile-icon-primary" aria-label="Create a journal post"><Icon name="edit" size={19}/></button>
      </AppTopBar>
      <header className="journal-header">
        <button className="journal-composer" onClick={()=>setShowCreate(true)}><Avatar src={user?.user?.profile_photo} name={user?.aura?.aura_name || 'You'} size={32} className="journal-avatar !text-sm"/><span>Share a little of your day…</span><Icon name="photo" size={18}/></button>
        <Glimpses key={targetGlimpse || 'feed'} myId={user?.user?.id} targetId={Number.isSafeInteger(targetGlimpse) && targetGlimpse > 0 ? targetGlimpse : null}
          onCloseTarget={() => setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('glimpse'); return next; }, { replace: true })}/>
        {targetPost ? <nav className="journal-tabs" aria-label="Post navigation">
          <button onClick={() => setSearchParams({})}>← Back to Journal</button>
        </nav> : <nav className="journal-tabs" aria-label="Journal filter"><button aria-pressed={feedTab==='all'} className={feedTab==='all'?'active':''} onClick={()=>setFeedTab('all')}>All moments</button><button aria-pressed={feedTab==='connections'} className={feedTab==='connections'?'active':''} onClick={()=>setFeedTab('connections')}>Your connections</button></nav>}
      </header>

      {error && <p className="text-red-400 text-sm px-5">{error}</p>}

      {/* Create Post Modal */}
      {showCreate && (
        <div className="aura-overlay fixed inset-0 bg-black/70 z-[70] flex items-end sm:items-center justify-center p-4 pb-24 sm:pb-4" onClick={() => setShowCreate(false)}>
          <div className="aura-card aura-glass-sheet aura-sheet-enter w-full max-w-md max-h-[calc(100vh-7rem)] overflow-y-auto rounded-[28px] p-4 sm:p-5" onClick={e => e.stopPropagation()}>
            <div className="aura-sheet-handle sm:hidden" />
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Create Post</h3>
              <button onClick={() => setShowCreate(false)} className="aura-pressable text-gray-400 hover:text-white">✕</button>
            </div>

            <div className="mb-4 space-y-3">
              <PostAudience value={audience} onChange={setAudience} disabled={creating}/>
              <PostIdentity value={identityMode} onChange={setIdentityMode} audience={audience} caption={caption} image={imageUrl} disabled={creating}/>
            </div>
            {imageUrl ? (
              <div className="relative mb-3">
                <img src={imageUrl} alt="preview" className="w-full h-64 object-cover rounded-xl" />
                <button
                  onClick={() => setImageUrl('')}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={preparingPhoto || creating}
                className="aura-pressable w-full h-40 border-2 border-dashed border-aura-border rounded-[24px] flex flex-col items-center justify-center text-gray-300 mb-3 aura-soft-button"
              >
                <Icon name="photo" size={30} className="mb-2 text-aura-violet-light"/>
                <span className="text-xs">{preparingPhoto ? 'Preparing photo…' : 'Tap to upload image (optional)'}</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              disabled={preparingPhoto || creating}
              className="hidden"
            />
            {photoError && <p role="alert" className="mb-3 text-xs text-red-600">{photoError}</p>}

            <PostPrompts caption={caption} disabled={creating} onChoose={next => { setCaption(next); captionInputRef.current?.focus(); }}/>
            <textarea
              ref={captionInputRef}
              aria-label="Post caption"
              maxLength={5000}
              className="aura-input resize-none mb-3"
              rows={3}
              placeholder="What's on your mind?"
              value={caption}
              onChange={e => setCaption(e.target.value)}
            />

            <div className="flex gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="aura-pressable aura-soft-button flex-1 py-3 rounded-2xl text-gray-200 text-sm font-bold"
              >
                Cancel
              </button>
              <button
                onClick={createPost} disabled={creating || preparingPhoto}
                className="aura-pressable aura-primary-button flex-1 py-3 rounded-2xl text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg,#897294,#b38d98)' }}
              >
                {creating?'Checking & posting…':'Post'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Posts */}
      {loading ? <ContentSkeleton/> : targetPost && visiblePosts.length === 0 ? (
        <p className="px-5 py-8 text-sm text-gray-500">This post is unavailable.</p>
      ) : visiblePosts.length === 0 ? (
        <div className="text-center py-20 px-8">
          <Icon name="feed" size={32} className="mx-auto mb-4 text-aura-violet-light"/>
          <p className="text-gray-400">{feedTab==='connections'?'No posts from your connections yet.':'No posts yet.'}</p>
          <p className="text-gray-500 text-sm mt-1">{feedTab==='connections'?'Posts shared with you by your connections will appear here.':'Be the first to share your aura!'}</p>
          {feedTab==='connections'?<button onClick={()=>setFeedTab('all')} className="aura-btn-primary mt-6">View all moments</button>:<button onClick={() => setShowCreate(true)} className="aura-btn-primary mt-6">Create Post</button>}
        </div>
      ) : (
        <div className="journal-list">
          {visiblePosts.map(post => {
            const own = post.user_id === user?.user?.id;
            return (
            <article key={post.id} className="journal-post">
              <header className="journal-post-header">
                <Avatar src={post.profile_photo} name={post.author_name || post.aura_name} size={41} className="journal-avatar"/>
                <div className="flex-1 min-w-0">
                  <h2>{post.author_name || post.aura_name}</h2>
                  <div className="journal-post-meta flex-wrap">
                    <time>{formatTime(post.created_at)}</time><span className="opacity-40">·</span>
                    <PostAudience value={post.visibility} confirmRealProfile={post.identity_mode==='profile'} onChange={own ? (value, confirmed) => changeAudience(post.id, value, confirmed) : undefined}/>
                    {post.edited_at && <span>· Edited</span>}
                  </div>
                </div>
                <div className="flex items-center self-start shrink-0">
                  <SavePostButton post={post} onSaved={saved => updatePost(post.id, { saved_by_me: saved })}/>
                  {own ? <>
                    <EditPostButton post={post} onEdited={changes => updatePost(post.id, changes)}/>
                    <DeletePostButton postId={post.id} onDeleted={id=>setPosts(previous=>previous.filter(item=>item.id!==id))}/>
                  </> : <ReportButton kind="post" postId={post.id} compact/>}
                </div>
              </header>
              {post.caption && <p className={`journal-caption ${!post.image_url?'text-post':''}`}>{post.caption}</p>}
              {/* Image (optional) */}
              {post.image_url && (
                <PostImage src={post.image_url} alt="Journal photo" className="w-full max-h-96 object-cover" />
              )}

              <footer className="journal-post-actions">
                <div className="journal-react-group"><ReactionButton reaction={post.my_reaction} onReact={reaction=>applyReaction(post.id,reaction)}/></div>
                <button onClick={()=>openComments(post)} className="journal-action" aria-label="View comments"><Icon name="talk" size={18}/><span>{post.comment_count>0?post.comment_count:'Comment'}</span></button>
                {post.visibility==='public'&&post.user_id!==user?.user?.id&&<div className="journal-connect"><AuraRequestButton postId={post.id} authorName={post.aura_name} matchId={post.match_id} canChat={post.can_chat}/></div>}
                <ReactionSummary counts={post.reaction_counts} total={post.like_count} onClick={()=>setReactionsPost(post)}/>
              </footer>
            </article>
            );
          })}
        </div>
      )}

      {reactionsPost && <ReactionList postId={reactionsPost.id} onClose={()=>setReactionsPost(null)}/>}

      {/* Comments Modal */}
      {commentsPost && (
        <div className="aura-overlay fixed inset-0 bg-black/70 z-[70] flex items-end sm:items-center justify-center pb-20 sm:pb-0" onClick={closeComments}>
          <div
            className="aura-card aura-glass-sheet aura-sheet-enter w-full max-w-md rounded-t-[28px] rounded-b-none sm:rounded-[28px] h-[75vh] sm:h-[70vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative flex justify-between items-center p-4 pt-7 sm:pt-4 border-b border-aura-border flex-shrink-0">
              <div className="absolute left-0 right-0 top-3 sm:hidden pointer-events-none">
                <div className="aura-sheet-handle" />
              </div>
              <h3 className="font-bold">Comments</h3>
              <button onClick={closeComments} className="aura-pressable text-gray-400 text-lg hover:text-white">✕</button>
            </div>

            {/* Comment list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {commentReactionError && <p role="alert" className="text-xs text-red-600">{commentReactionError}</p>}
              {commentsLoading ? (
                <p className="text-gray-500 text-sm text-center">Loading...</p>
              ) : comments.length === 0 ? (
                <p className="text-gray-500 text-sm text-center pt-8">No comments yet. Be the first!</p>
              ) : (
                topLevelComments.map(c => (
                  <div key={c.id} className="space-y-3">
                    {renderCommentRow(c, false)}
                    {childrenOf(c.id).length > 0 && (
                      <div className="ml-10 space-y-3">
                        {renderRepliesFlat(c.id)}
                      </div>
                    )}
                  </div>
                ))
              )}
              <div ref={commentsEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-aura-border flex gap-2 flex-shrink-0">
              <input
                className="aura-input flex-1 text-sm"
                placeholder="Add a comment..."
                value={commentInput}
                onChange={e => setCommentInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addComment()}
              />
              <button
                onClick={addComment}
                className="aura-pressable aura-primary-button px-4 rounded-2xl bg-aura-violet text-white text-sm font-bold"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}


