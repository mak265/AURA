import { useState } from 'react';

export function ProfileSilhouette({ gender, className = '' }) {
  const variant = typeof gender === 'string' ? gender.trim().toLowerCase() : '';
  return <svg className={className} viewBox="0 0 48 48" fill="currentColor" aria-hidden="true" focusable="false">
    {variant === 'female' ? <>
      <path d="M24 4C15 4 10 10 10 19c0 7.5-1.2 11-4 14.5 4.9 2 9.4 1 13-1.6 2.8 2.2 7.2 2.2 10 0 3.6 2.6 8.1 3.6 13 1.6-2.8-3.5-4-7-4-14.5C38 10 33 4 24 4Z"/>
      <path d="M16 19c4-1 7-3 9-6 1.6 3.1 4.2 5.2 7 6v3c0 5.3-3.6 9-8 9s-8-3.7-8-9Z" fill="var(--avatar-face, #ebe7f2)" opacity=".72"/>
      <path d="M19 31h10v3c0 2 2.2 3 5.4 4.3 3.3 1.3 6.4 3.3 7.6 6.7H6c1.2-3.4 4.3-5.4 7.6-6.7C16.8 37 19 36 19 34Z"/>
    </> : variant === 'male' ? <>
      <path d="M24 6c-5.8 0-10 4.2-10 10v4.2c0 4.5 2.2 8.1 5.5 10v2c0 1.7-1.4 2.5-4.4 3.6C9.6 37.7 6.1 40.3 5 44h38c-1.1-3.7-4.6-6.3-10.1-8.2-3-1.1-4.4-1.9-4.4-3.6v-2c3.3-1.9 5.5-5.5 5.5-10V16c0-5.8-4.2-10-10-10Z"/>
    </> : <>
      <circle cx="24" cy="16.5" r="9"/>
      <path d="M6 44c.6-8 8.1-14 18-14s17.4 6 18 14H6Z"/>
    </>}
  </svg>;
}

export default function Avatar({ src, name = 'Aura', gender, size = 40, className = '' }) {
  const [failed, setFailed] = useState(null);
  const hasPhoto = Boolean(src && failed !== src);
  return <span className={`user-avatar ${className}${hasPhoto ? '' : ' user-avatar-default'}`} style={{width:size,height:size}}>
    {hasPhoto ? <img src={src} alt={`${name}'s profile`} onError={()=>setFailed(src)}/>
      : <ProfileSilhouette gender={gender} className="user-avatar-silhouette"/>}
  </span>;
}
