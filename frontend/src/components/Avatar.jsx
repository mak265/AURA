import { useState } from 'react';
export default function Avatar({ src, name = 'Aura', size = 40, className = '' }) {
  const [failed,setFailed]=useState(null);
  return <span className={`user-avatar ${className}`} style={{width:size,height:size}}>{src&&failed!==src?<img src={src} alt={`${name}'s profile`} onError={()=>setFailed(src)}/>:<span aria-hidden="true">{name.charAt(0)}</span>}</span>;
}
