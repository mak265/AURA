import ReportButton from './ReportButton';
import DeletePostButton from './DeletePostButton';
import Avatar from './Avatar';
import PostActivity from './PostActivity';
import PostAudience from './PostAudience';
import PostImage from './PostImage';
import { useRef, useState } from 'react';
import api from '../api/client';
import Icon from './Icon';

export default function ProfilePosts({ posts, name, photo, own = false, loading = false, error = '', onCreated }) {
  const [deleted,setDeleted]=useState([]);
  const [audience,setAudience] = useState('public');
  const [audiences,setAudiences] = useState({});
  const [updating,setUpdating] = useState(null);
  const changePrivacy = async (id,visibility) => {
    setUpdating(id);setPostError('');
    try {await api.patch(`/feed/${id}/privacy`,{visibility});setAudiences(values=>({...values,[id]:visibility}));}
    catch(err){setPostError(err.response?.data?.error||'Unable to change audience.');}
    finally{setUpdating(null);}
  };
  const [caption, setCaption] = useState('');
  const [image, setImage] = useState('');
  const [saving, setSaving] = useState(false);
  const [postError, setPostError] = useState('');
  const upload = useRef(null);
  const createPost = async event => {
    event.preventDefault();
    if (!caption.trim() && !image) return;
    setSaving(true); setPostError('');
    try {
      const response = await api.post('/feed', { caption: caption.trim(), image_url: image || null, visibility:audience });
      onCreated(response.data);
      setCaption(''); setImage('');
      if (upload.current) upload.current.value = '';
    } catch (err) { setPostError(err.response?.data?.error || 'Unable to publish your post.'); }
    finally { setSaving(false); }
  };
  const chooseImage = event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) {
      setPostError('Choose an image smaller than 8 MB.'); return;
    }
    const reader = new FileReader();
    reader.onload = () => { setImage(reader.result); setPostError(''); };
    reader.onerror = () => setPostError('Unable to open that image.');
    reader.readAsDataURL(file);
  };
  return <div className="space-y-4">
    {own && <form onSubmit={createPost} className="aura-card p-4 space-y-3">
      <div className="mb-3"><PostAudience value={audience} onChange={setAudience} disabled={saving}/></div>
      <label htmlFor="profile-post" className="text-sm font-medium">Share a little of your day</label>
      <textarea id="profile-post" rows={3} maxLength={5000} className="aura-input resize-none" placeholder="What's on your mind?" value={caption} onChange={event => setCaption(event.target.value)} disabled={saving}/>
      {image && <div><img src={image} alt="Your selected photo" className="w-full rounded-lg max-h-64 object-cover"/><button type="button" disabled={saving} onClick={() => { setImage(''); upload.current.value=''; }} className="text-xs text-gray-400 mt-2">Remove photo</button></div>}
      <div className="flex items-center justify-between gap-4"><label className="text-xs text-aura-violet-light cursor-pointer flex items-center gap-2"><Icon name="feed" size={16}/> Add photo<input ref={upload} type="file" accept="image/*" className="sr-only" onChange={chooseImage} disabled={saving}/></label><button type="submit" className="aura-btn-primary !w-auto !py-2 !px-5 text-xs" disabled={saving || (!caption.trim() && !image)}>{saving ? 'Posting…' : 'Post'}</button></div>
      <p className="text-[10px] text-gray-400">Choose who can see this post. You can change its audience later.</p>
      {postError && <p role="alert" className="text-xs text-red-400">{postError}</p>}
    </form>}
    {postError && !own && <p role="alert" className="text-xs text-red-400">{postError}</p>}
    {loading ? <p className="text-sm text-gray-400 py-5">Loading posts…</p> : error ? <p role="alert" className="text-sm text-red-400">{error}</p> : posts.length === 0 ? <div className="aura-card px-5 py-10 text-center"><Icon name="feed" className="mx-auto text-aura-violet-light" size={26}/><h3 className="font-medium text-sm mt-4">{own ? 'Your story starts here' : 'No posts yet'}</h3><p className="text-xs text-gray-400 mt-2">{own ? 'Share a thought, a photo, or a small moment.' : 'Check back for a little more of their world.'}</p></div> : posts.filter(post=>!deleted.includes(post.id)).map(post => <article key={post.id} className="aura-card overflow-hidden">
      <header className="p-4 flex items-center gap-3"><Avatar src={photo} name={name} size={35} className="profile-post-avatar"/><div><h3 className="font-medium text-sm">{name}</h3><PostAudience value={audiences[post.id] || post.visibility} onChange={own?value=>changePrivacy(post.id,value):undefined} disabled={updating===post.id}/><br/><time className="text-[10px] text-gray-400" dateTime={post.created_at}>{new Date(post.created_at).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</time></div>{own&&<DeletePostButton postId={post.id} onDeleted={id=>setDeleted(previous=>[...previous,id])}/>} {!own&&<ReportButton kind="post" postId={post.id} compact/>}</header>
      {post.caption && <p className="px-4 pb-4 text-sm leading-relaxed whitespace-pre-wrap break-words">{post.caption}</p>}
      {post.image_url && <PostImage src={post.image_url} alt="Journal photo" className="w-full max-h-[520px] object-contain bg-aura-bg"/>}
      <PostActivity post={post}/>
    </article>)}
  </div>;
}
