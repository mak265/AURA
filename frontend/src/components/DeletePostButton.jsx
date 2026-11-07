import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client';
import Icon from './Icon';
function DeletePostDialog({ postId, onClose, onDeleted }) {
 const dialog=useRef(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const previous=document.activeElement,element=dialog.current;element.showModal();return()=>{element.close();if(previous?.isConnected)previous.focus();};},[]);
 const remove=async()=>{setBusy(true);setError('');try{await api.delete(`/feed/${postId}`);onDeleted(postId);onClose();}catch(err){setError(err.response?.data?.error||'Unable to delete post. Please try again.');}finally{setBusy(false);}};
 return createPortal(<dialog ref={dialog} className="message-confirm-dialog" aria-labelledby="delete-post-title" aria-describedby="delete-post-description" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <div className="message-confirm-icon"><Icon name="trash" size={25}/></div><h2 id="delete-post-title">Delete this post?</h2>
  <p id="delete-post-description">Your post, photo, reactions, and comments will be permanently removed.</p><div className="message-confirm-note">You cannot undo this action.</div>
  {error&&<p role="alert" className="message-confirm-error">{error}</p>}
  <div className="message-confirm-actions"><button autoFocus disabled={busy} onClick={onClose}>Keep post</button><button disabled={busy} className="confirm-remove" onClick={remove}>{busy?'Deleting…':'Delete post'}</button></div>
 </dialog>,document.body);
}
export default function DeletePostButton({ postId, onDeleted }) {
 const [open,setOpen]=useState(false);
 return <><button type="button" className="delete-post-button" title="Delete post" aria-label="Delete post" onClick={()=>setOpen(true)}><Icon name="trash" size={17}/></button>{open&&<DeletePostDialog postId={postId} onClose={()=>setOpen(false)} onDeleted={onDeleted}/>}</>;
}
