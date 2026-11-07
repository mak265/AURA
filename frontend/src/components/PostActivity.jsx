import ReactionIcon from './ReactionIcon';
import { useState } from 'react';
import api from '../api/client';
const REACTIONS = ['like','love','care','haha','wow','sad','angry'];
export default function PostActivity({ post }) {
  const [tab,setTab] = useState(null);
  const [reactions,setReactions] = useState([]);
  const [comments,setComments] = useState([]);
  const [counts,setCounts] = useState({reactions:Number(post.like_count||0),comments:Number(post.comment_count||0)});
  const [loading,setLoading] = useState(false);
  const [saving,setSaving] = useState(false);
  const [text,setText] = useState('');
  const [reply,setReply] = useState(null);
  const [error,setError] = useState('');
  const refresh = async () => {
    const [r,c] = await Promise.all([api.get(`/feed/${post.id}/reactions`),api.get(`/feed/${post.id}/comments`)]);
    setReactions(r.data);setComments(c.data);setCounts({reactions:r.data.length,comments:c.data.length});
  };
  const open = async value => {
    if(tab===value){setTab(null);return;}
    setTab(value);setLoading(true);setError('');
    try {await refresh();} catch(err){setReactions([]);setComments([]);setError(err.response?.data?.error || 'Unable to load post activity.');}
    finally{setLoading(false);}
  };
  const react = async reaction => {
    setSaving(true);setError('');
    try {await api.post(`/feed/${post.id}/like`,{reaction});await refresh();}
    catch(err){setError(err.response?.data?.error || 'Unable to react.');}finally{setSaving(false);}
  };
  const comment = async event => {
    event.preventDefault();if(!text.trim())return;setSaving(true);setError('');
    try {await api.post(`/feed/${post.id}/comments`,{text:text.trim(),parent_id:reply?.id});setText('');setReply(null);await refresh();}
    catch(err){setError(err.response?.data?.error || 'Unable to comment.');}finally{setSaving(false);}
  };
  return <div className="border-t border-aura-border">
    <div className="flex justify-between px-4 py-3 text-xs text-gray-400"><button onClick={()=>open('reactions')} aria-expanded={tab==='reactions'}>{counts.reactions} {counts.reactions===1?'reaction':'reactions'}</button><button onClick={()=>open('comments')} aria-expanded={tab==='comments'}>{counts.comments} {counts.comments===1?'comment':'comments'}</button></div>
    {tab && <section aria-label={tab==='reactions'?'Post reactions':'Post comments'} className="border-t border-aura-border p-4 space-y-4">
      <div className="flex justify-between items-center"><h4 className="text-sm font-medium">{tab==='reactions'?'Reactions':'Comments'}</h4><button onClick={()=>setTab(null)} aria-label="Close post activity" className="text-xs text-gray-400">Close</button></div>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {loading ? <p className="text-xs text-gray-400">Loading…</p> : tab==='reactions' ? <>
        <div className="flex justify-between gap-1">{REACTIONS.map(id=><button key={id} aria-label={`React ${id}`} disabled={saving} onClick={()=>react(id)} className="p-2 rounded-lg bg-aura-elevated text-xl"><ReactionIcon type={id} size={30}/></button>)}</div>
        {reactions.length===0?<p className="text-xs text-gray-400">No reactions yet.</p>:reactions.map(r=><div key={r.user_id} className="flex justify-between items-center text-sm"><span>{r.aura_name || 'Anonymous'}</span><ReactionIcon type={r.reaction} size={28}/></div>)}
      </> : <>
        {comments.length===0 && <p className="text-xs text-gray-400">No comments yet. Start the conversation.</p>}
        {comments.map(c=><article key={c.id} className={c.parent_id?'ml-5 border-l border-aura-border pl-3':'bg-aura-elevated rounded-xl p-3'}><p className="text-xs font-medium">{c.aura_name || 'Anonymous'}</p>{c.parent_id&&<p className="text-[10px] text-gray-400 mt-1">Replying to {comments.find(parent=>parent.id===c.parent_id)?.aura_name || 'a comment'}</p>}<p className="text-sm mt-1 whitespace-pre-wrap break-words">{c.text}</p><button className="text-[10px] text-aura-violet-light mt-2" onClick={()=>setReply(c)}>Reply</button></article>)}
        <form onSubmit={comment} className="space-y-2">{reply && <p className="text-xs text-gray-400">Replying to {reply.aura_name} <button type="button" onClick={()=>setReply(null)} className="text-aura-violet-light ml-2">Cancel</button></p>}<label className="sr-only" htmlFor={`comment-${post.id}`}>Write a comment</label><textarea id={`comment-${post.id}`} rows={2} maxLength={2000} value={text} onChange={e=>setText(e.target.value)} placeholder="Write a comment…" className="aura-input resize-none"/><button disabled={saving||!text.trim()} className="aura-btn-primary !py-2 text-xs">{saving?'Sending…':reply?'Reply':'Comment'}</button></form>
      </>}
    </section>}
  </div>;
}

