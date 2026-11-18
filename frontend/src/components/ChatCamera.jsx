import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

export default function ChatCamera({ onCapture, onClose }) {
  const video = useRef(null);
  const dialog = useRef(null);
  const [facing, setFacing] = useState('environment');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const front = facing === 'user';

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    let active = true;
    let stream;
    const preview = video.current;
    async function openCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera unavailable. Use Photo to select an image.');
        return;
      }
      try {
        const input = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: front ? { exact: 'user' } : { ideal: 'environment' } },
          audio: false,
        });
        if (!active) {
          input.getTracks().forEach(track => track.stop());
          return;
        }
        stream = input;
        preview.srcObject = stream;
      } catch (err) {
        if (!active) return;
        setError(front && ['OverconstrainedError', 'NotFoundError'].includes(err.name)
          ? 'Front camera unavailable. Switch back or use Photo.'
          : 'Unable to open camera. Allow camera access, or use Photo.');
      }
    }
    openCamera();
    return () => {
      active = false;
      stream?.getTracks().forEach(track => track.stop());
      preview.srcObject = null;
    };
  }, [front]);

  const switchCamera = () => {
    setReady(false);
    setError('');
    setFacing(front ? 'environment' : 'user');
  };

  const capture = () => {
    const preview = video.current;
    if (!preview.videoWidth || !preview.videoHeight) return;
    const canvas = document.createElement('canvas');
    const ratio = preview.clientWidth / preview.clientHeight;
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    const width = Math.min(preview.videoWidth, preview.videoHeight * ratio);
    const height = Math.min(preview.videoHeight, preview.videoWidth / ratio);
    const scale = Math.min(1, 1600 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return;
    if (front) { context.translate(canvas.width, 0); context.scale(-1, 1); }
    context.drawImage(preview, (preview.videoWidth-width)/2, (preview.videoHeight-height)/2,
      width, height, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL('image/jpeg', .87));
  };

  return createPortal(
    <dialog ref={dialog} className="chat-camera" aria-label="Camera"
      onCancel={event => { event.preventDefault(); onClose(); }}>
      <header className="camera-top">
        <button type="button" className="camera-icon-button" aria-label="Close camera" onClick={onClose}>×</button>
        <h2>Camera</h2>
      </header>
      <div className="camera-viewfinder">
        <video key={facing} ref={video} className={front ? 'camera-selfie' : undefined} hidden={!!error}
          autoPlay muted playsInline onLoadedData={() => setReady(true)}/>
        {error ? <p role="alert">{error}</p> : !ready && <p role="status">Opening camera…</p>}
      </div>
      <footer className="camera-controls">
        <span/>
        <button type="button" className="camera-shutter" aria-label="Take photo" disabled={!ready || !!error} onClick={capture}/>
        <button type="button" className="camera-icon-button" aria-label={front ? 'Use rear camera' : 'Use front camera'}
          onClick={switchCamera}><Icon name="flip-camera" size={24}/></button>
      </footer>
    </dialog>, document.body
  );
}
