import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getCropRect } from '../profileCrop';

export default function ProfilePhotoCropper({ image, saving, error, onCancel, onSave, fallbackRef }) {
  const dialog = useRef(null), canvas = useRef(null), drag = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: .5, y: .5 });
  useEffect(() => {
    const previous = document.activeElement, fallback = fallbackRef.current, element = dialog.current;
    element.showModal();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); else fallback?.focus(); };
  }, [fallbackRef]);
  useEffect(() => {
    const context = canvas.current.getContext('2d');
    const crop = getCropRect(image.width, image.height, zoom, position);
    context.fillStyle = '#fff'; context.fillRect(0, 0, 512, 512);
    context.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, 512, 512);
  }, [image, zoom, position]);
  const move = event => {
    if (!drag.current || saving) return;
    const start = drag.current;
    const ratio = start.crop.size / event.currentTarget.clientWidth;
    const next = getCropRect(image.width, image.height, zoom, {
      x: (start.crop.x + start.crop.size / 2 - (event.clientX - start.x) * ratio) / image.width,
      y: (start.crop.y + start.crop.size / 2 - (event.clientY - start.y) * ratio) / image.height,
    });
    setPosition({ x: (next.x + next.size / 2) / image.width, y: (next.y + next.size / 2) / image.height });
  };
  const changeZoom = value => {
    const current = getCropRect(image.width, image.height, zoom, position);
    setPosition({ x: (current.x + current.size / 2) / image.width, y: (current.y + current.size / 2) / image.height });
    setZoom(value);
  };
  return createPortal(<dialog ref={dialog} className="photo-crop-dialog" aria-labelledby="photo-crop-title" onCancel={event => { event.preventDefault(); if (!saving) onCancel(); }}>
    <header><h2 id="photo-crop-title">Adjust your profile photo</h2><p>Drag to reposition. Zoom to get the framing right.</p></header>
    <div className="photo-crop-stage" role="region" aria-label="Photo crop preview. Drag or use arrow keys to reposition." tabIndex={0}
      onPointerDown={event => { if (saving || event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, crop: getCropRect(image.width, image.height, zoom, position) }; }}
      onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={event => {
        if (saving || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const current = getCropRect(image.width, image.height, zoom, position);
        const delta = event.shiftKey ? .06 : .02;
        setPosition({ x: (current.x + current.size / 2) / image.width + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0), y: (current.y + current.size / 2) / image.height + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0) });
      }}><canvas ref={canvas} width={512} height={512}/><div className="photo-crop-guide" aria-hidden="true"/></div>
    <div className="photo-crop-controls"><label htmlFor="photo-crop-zoom">Zoom <span>{Math.round(zoom * 100)}%</span></label><input id="photo-crop-zoom" type="range" min="1" max="4" step="0.05" value={zoom} disabled={saving} onChange={event => changeZoom(Number(event.target.value))}/><button disabled={saving} onClick={() => { setZoom(1); setPosition({ x:.5, y:.5 }); }}>Reset framing</button></div>
    {error && <p role="alert" className="text-sm text-red-600 px-5">{error}</p>}
    <footer><button disabled={saving} onClick={onCancel} className="aura-btn-secondary !py-3 text-sm">Cancel</button><button disabled={saving} onClick={() => onSave(canvas.current.toDataURL('image/jpeg', .88))} className="aura-btn-primary !py-3 text-sm">{saving ? 'Saving…' : 'Save photo'}</button></footer>
  </dialog>, document.body);
}
