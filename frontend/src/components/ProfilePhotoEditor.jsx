import ProfilePhotoCropper from './ProfilePhotoCropper';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client';
import Icon from './Icon';
function RemovePhotoConfirmation({ saving, error, onCancel, onConfirm, fallbackRef }) {
  const dialog=useRef(null);
  useEffect(()=>{
    const previousFocus=document.activeElement;
    const fallbackElement=fallbackRef.current;
    const element=dialog.current;element.showModal();
    return()=>{element.close();if(previousFocus?.isConnected)previousFocus.focus();else fallbackElement?.focus();};
  },[fallbackRef]);
  return createPortal(<dialog ref={dialog} className="remove-photo-dialog" aria-labelledby="remove-photo-title" aria-describedby="remove-photo-description" onCancel={event=>{event.preventDefault();if(!saving)onCancel();}} onClick={event=>{if(event.target===dialog.current&&!saving)onCancel();}}>
    <div className="remove-photo-content"><div className="remove-photo-symbol"><Icon name="photo" size={25}/></div><h2 id="remove-photo-title">Remove profile photo?</h2><p id="remove-photo-description">Are you sure you want to remove your profile photo? Your initials will appear instead.</p>
    {error&&<p role="alert" className="text-sm text-red-600 mt-4">{error}</p>}
    <div className="flex gap-3 mt-6"><button autoFocus onClick={onCancel} disabled={saving} className="aura-btn-secondary !py-3 text-sm">Cancel</button><button onClick={onConfirm} disabled={saving} className="aura-btn-primary !py-3 text-sm">{saving?'Removing…':'Remove photo'}</button></div></div>
  </dialog>,document.body);
}
export default function ProfilePhotoEditor({ photo, onSaved }) {
  const changeButton=useRef(null);
  const [cropImage,setCropImage]=useState(null);
  useEffect(()=>()=>cropImage?.close(),[cropImage]);
  const [confirmOpen,setConfirmOpen]=useState(false);
  const input=useRef(null),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const save=async value=>{await api.put('/profile/photo',{photo:value});await onSaved(value);};
  const upload=async event=>{
    const file=event.target.files[0];if(!file)return;setError('');
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024){setError('Choose a JPEG, PNG or WebP photo under 8 MB.');return;}
    setSaving(true);
    try{
      const image=await createImageBitmap(file);
      setCropImage(image);
    }catch(err){setError(err.response?.data?.error||'Unable to save that photo. Please try another image.');}
    finally{setSaving(false);input.current.value='';}
  };
  const saveCrop=async photo=>{setSaving(true);setError('');try{await save(photo);setCropImage(null);}catch(err){setError(err.response?.data?.error||'Unable to save your photo. Please try again.');}finally{setSaving(false);}};
  const remove=async()=>{setSaving(true);setError('');try{await save(null);setConfirmOpen(false);}catch{setError('Unable to remove your photo.');}finally{setSaving(false);}};
  return <div className="profile-photo-editor">{cropImage&&<ProfilePhotoCropper image={cropImage} saving={saving} error={error} onSave={saveCrop} onCancel={()=>{if(!saving){setCropImage(null);setError('');}}} fallbackRef={changeButton}/>}{confirmOpen&&<RemovePhotoConfirmation saving={saving} error={error} onCancel={()=>{if(!saving){setConfirmOpen(false);setError('');}}} onConfirm={remove} fallbackRef={changeButton}/>}<input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose profile picture" className="sr-only" onChange={upload} disabled={saving}/><button ref={changeButton} onClick={()=>input.current.click()} disabled={saving} className="photo-edit-button"><Icon name="photo" size={14}/>{saving?'Saving…':photo?'Change photo':'Add profile photo'}</button>{photo&&<button onClick={()=>{setError('');setConfirmOpen(true);}} disabled={saving} className="text-[10px] text-gray-400">Remove</button>}{error&&!confirmOpen&&!cropImage&&<p role="alert" className="text-xs text-red-400 w-full">{error}</p>}<p className="text-[10px] text-gray-400 w-full">Your photo is visible only to you and mutually revealed connections.</p></div>;
}
