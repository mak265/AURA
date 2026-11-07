import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function ImageViewer({ src, alt, onClose }) {
  const dialog = useRef(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  return createPortal(<dialog ref={dialog} className="image-viewer" aria-label="Full image viewer" onCancel={onClose}>
    <header className="image-viewer-toolbar">
      <span className="text-xs text-gray-300">Photo</span>
      <div className="flex items-center gap-2">
        <button aria-label="Zoom out" disabled={zoom===1} onClick={()=>setZoom(value=>Math.max(1,value-.5))}>−</button>
        <button aria-label="Reset zoom" onClick={()=>setZoom(1)} className="!w-auto px-3 text-xs">{Math.round(zoom*100)}%</button>
        <button aria-label="Zoom in" disabled={zoom===4} onClick={()=>setZoom(value=>Math.min(4,value+.5))}>+</button>
        <button autoFocus aria-label="Close image" onClick={onClose} className="ml-3">×</button>
      </div>
    </header>
    <div className="image-viewer-stage"><div className="image-viewer-canvas" style={{width:`${zoom*100}%`,height:`${zoom*100}%`}}><img src={src} alt={alt}/></div></div>
    <p className="image-viewer-hint">Use + to zoom. Scroll to explore. Press Esc to close.</p>
  </dialog>,document.body);
}
export default function PostImage({ src, alt = 'Journal photo', className = '' }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={event=>{event.stopPropagation();setOpen(true);}} className="block w-full cursor-zoom-in text-left" aria-label="View full image">
      <img src={src} alt={alt} loading="lazy" decoding="async" className={className}/>
    </button>
    {open && <ImageViewer src={src} alt={alt} onClose={()=>setOpen(false)}/>}
  </>;
}
