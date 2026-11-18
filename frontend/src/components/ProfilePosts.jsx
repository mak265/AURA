import ReportButton from './ReportButton';
import DeletePostButton from './DeletePostButton';
import Avatar from './Avatar';
import PostActivity from './PostActivity';
import PostAudience from './PostAudience';
import PostIdentity from './PostIdentity';
import PostImage from './PostImage';
import PostPrompts from './PostPrompts';
import { EditPostButton, SavePostButton } from './PostActions';
import { Link } from 'react-router-dom';
import { useRef, useState } from 'react';
import api from '../api/client';
import Icon from './Icon';
import { prepareJournalPhoto } from '../photoUpload';

export default function ProfilePosts({ posts, identityProfile, own = false, savedList = false, loading = false, error = '', onCreated, onUpdated, onDeleted, onUnsave }) {
  const [audience,setAudience] = useState('public');
  const [identityMode, setIdentityMode] = useState('aura');
  const [postChanges, setPostChanges] = useState({});
  const updatePost = (id, changes) => {
    if (onUpdated) onUpdated(id, changes);
    else setPostChanges(previous => ({ ...previous, [id]: { ...previous[id], ...changes } }));
  };
  const [updating,setUpdating] = useState(null);
  const changePrivacy = async (id,visibility,confirmed) => {
    setUpdating(id);setPostError('');
    try {await api.patch(`/feed/${id}/privacy`,{visibility,confirm_profile_visibility: confirmed === true});updatePost(id, { visibility });}
    catch(err){setPostError(err.response?.data?.error||'Unable to change audience.');}
    finally{setUpdating(null);}
  };
  const [caption, setCaption] = useState('');
  const [image, setImage] = useState('');
  const [saving, setSaving] = useState(false);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [postError, setPostError] = useState('');
  const upload = useRef(null);
  const captionInput = useRef(null);
  const createPost = async event => {
    event.preventDefault();
    if (saving || preparingPhoto || (!caption.trim() && !image)) return;
    setSaving(true); setPostError('');
    try {
      const response = await api.post('/feed', { caption: caption.trim(), image_url: image || null, visibility:audience, identity_mode: identityMode });
      onCreated(response.data);
      setCaption(''); setImage('');
      setIdentityMode('aura');
      if (upload.current) upload.current.value = '';
    } catch (err) { setPostError(err.response?.data?.error || 'Unable to publish your post.'); }
    finally { setSaving(false); }
  };
  const chooseImage = async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setPreparingPhoto(true);
    setPostError('');
    try {
      setImage(await prepareJournalPhoto(file));
    } catch {
      setPostError('Unable to prepare that photo. Try a JPEG, PNG, or WebP image.');
    } finally {
      setPreparingPhoto(false);
    }
  };
  return <div className="space-y-4">
    {own && <form onSubmit={createPost} className="aura-card p-4 space-y-3">
      <div className="mb-3"><PostAudience value={audience} onChange={setAudience} disabled={saving}/></div>
      <PostIdentity value={identityMode} onChange={setIdentityMode} audience={audience} profile={identityProfile} caption={caption} image={image} disabled={saving}/>
      <label htmlFor="profile-post" className="text-sm font-medium">Share a little of your day</label>
      <PostPrompts caption={caption} disabled={saving} onChoose={next => { setCaption(next); captionInput.current?.focus(); }}/>
      <textarea ref={captionInput} id="profile-post" rows={3} maxLength={5000} className="aura-input resize-none" placeholder="What's on your mind?" value={caption} onChange={event => setCaption(event.target.value)} disabled={saving}/>
      {image && <div><img src={image} alt="Your selected photo" className="w-full rounded-lg max-h-64 object-cover"/><button type="button" disabled={saving} onClick={() => { setImage(''); upload.current.value=''; }} className="text-xs text-gray-400 mt-2">Remove photo</button></div>}
      <div className="flex items-center justify-between gap-4"><label className="text-xs text-aura-violet-light cursor-pointer flex items-center gap-2"><Icon name="feed" size={16}/> {preparingPhoto ? 'Preparing photo…' : 'Add photo'}<input ref={upload} type="file" accept="image/*" className="sr-only" onChange={chooseImage} disabled={saving || preparingPhoto}/></label><button type="submit" className="aura-btn-primary !w-auto !py-2 !px-5 text-xs" disabled={saving || preparingPhoto || (!caption.trim() && !image)}>{saving ? 'Posting…' : 'Post'}</button></div>
      <p className="text-[10px] text-gray-400">Choose who can see this post. You can change its audience later.</p>
      {postError && <p role="alert" className="text-xs text-red-400">{postError}</p>}
    </form>}
    {postError && !own && <p role="alert" className="text-xs text-red-400">{postError}</p>}
    {loading && <p className="text-sm text-gray-400 py-5">Loading posts…</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {!loading && !error && posts.length === 0 && <div className="aura-card px-5 py-10 text-center">
      <Icon name={savedList ? 'bookmark' : 'feed'} className="mx-auto text-aura-violet-light" size={26}/>
      <h3 className="font-medium text-sm mt-4">{savedList ? 'No saved posts' : own ? 'Your story starts here' : 'No posts yet'}</h3>
      <p className="text-xs text-gray-400 mt-2">{savedList ? 'Use the bookmark on any post to find it here.' : own ? 'Share a thought, a photo, or a small moment.' : 'Check back for a little more of their world.'}</p>
    </div>}
    {!loading && !error && posts.map(item => {
      const post = { ...item, ...postChanges[item.id] };
      return <article key={post.id} className="aura-card">
        <header className="p-4 flex items-center gap-2">
          <Avatar src={post.profile_photo} name={post.author_name || 'Aura'} size={35} className="profile-post-avatar"/>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-sm break-words">{post.author_name || identityProfile?.auraName || 'Aura'}</h3>
            <PostAudience value={post.visibility} confirmRealProfile={post.identity_mode==='profile'} onChange={own ? (value, confirmed) => changePrivacy(post.id, value, confirmed) : undefined} disabled={updating===post.id}/>
            <div className="text-[10px] text-gray-400">
              <time dateTime={post.created_at}>{new Date(post.created_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time>
              {post.edited_at && ' · Edited'}
            </div>
          </div>
          <div className="flex items-center self-start shrink-0">
            <SavePostButton post={post} onSaved={saved => {
              updatePost(post.id, { saved_by_me: saved });
              if (!saved) onUnsave?.(post.id);
            }}/>
            {own ? <>
              <EditPostButton post={post} onEdited={changes => updatePost(post.id, changes)}/>
              <DeletePostButton postId={post.id} onDeleted={onDeleted}/>
            </> : !savedList && <ReportButton kind="post" postId={post.id} compact/>}
          </div>
        </header>
        {post.caption && <p className="px-4 pb-4 text-sm leading-relaxed whitespace-pre-wrap break-words">{post.caption}</p>}
        {post.image_url && <PostImage src={post.image_url} alt="Journal photo" className="w-full max-h-[520px] object-contain bg-aura-bg"/>}
        {savedList && <Link className="inline-block px-4 pb-3 text-xs text-aura-violet-light" to={`/feed?post=${post.id}`}>Open in Journal</Link>}
        <PostActivity post={post}/>
      </article>;
    })}
  </div>;
}
