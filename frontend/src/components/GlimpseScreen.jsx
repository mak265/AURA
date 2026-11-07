import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
export default function GlimpseScreen({ children, onClose, label, className='' }) {
 const dialog=useRef(null);
 useEffect(()=>{const element=dialog.current,previous=document.activeElement,overflow=document.body.style.overflow;document.body.style.overflow='hidden';element.showModal();return()=>{element.close();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};},[]);
 return createPortal(<dialog ref={dialog} aria-label={label} className={`glimpse-screen ${className}`} onCancel={event=>{event.preventDefault();onClose();}}>{children}</dialog>,document.body);
}
