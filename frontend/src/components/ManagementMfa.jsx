import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import api from '../api/client';
import Icon from './Icon';
import LogoutButton from './LogoutButton';

export default function ManagementMfa({ mode, onVerified, onSignOut }) {
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [qrFailed, setQrFailed] = useState(false);
  const qrCanvas = useRef(null);
  const needsKey = mode === 'setup' && !secret;

  useEffect(() => {
    if (!secret || !qrCanvas.current) return;
    let active = true;
    const uri = `otpauth://totp/AURA:Superadmin?secret=${encodeURIComponent(secret)}&issuer=AURA&algorithm=SHA1&digits=6&period=30`;
    QRCode.toCanvas(qrCanvas.current, uri, { width: 212, margin: 3, errorCorrectionLevel: 'M' })
      .catch(() => { if (active) setQrFailed(true); });
    return () => { active = false; };
  }, [secret]);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (needsKey) {
        const { data } = await api.post('/admin/mfa/setup', { password });
        setPassword('');
        setQrFailed(false);
        setSecret(data.secret);
      } else {
        const { data } = await api.post('/admin/mfa/verify', { code });
        sessionStorage.setItem('aura_management_token', data.token);
        setSecret('');
        onVerified();
      }
    } catch (error) {
      if (error.response?.data?.code === 'MFA_SETUP_REQUIRED') setSecret('');
      setError(error.response?.data?.error || 'Unable to verify your authenticator.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="admin-password-card">
    <Icon name="lock" size={30}/>
    <h1>{mode === 'setup' ? 'Set up an authenticator' : 'Verify your sign-in'}</h1>
    <p>{needsKey
      ? 'Confirm your password to create a setup key for your authenticator app.'
      : 'Enter the six-digit AURA code from your authenticator app.'}</p>
    {secret && <div className="admin-warning">
      {!qrFailed && <>
        <p>Open your authenticator app, tap <strong>+</strong>, then choose <strong>Scan a QR code</strong>.</p>
        <canvas ref={qrCanvas} role="img" aria-label="AURA authenticator setup QR code" className="mx-auto my-3 block max-w-full rounded-lg" />
      </>}
      <details open={qrFailed || undefined}>
        <summary className="cursor-pointer">Enter the setup key manually</summary>
        <p>Add a time-based account named AURA Superadmin and enter this key.</p>
        <code className="block mt-2 break-all select-all">{secret}</code>
      </details>
      <p className="mt-2">Keep this QR and setup key private.</p>
    </div>}
    <form onSubmit={submit}>
      {needsKey ? <label>Current password
        <input type="password" autoComplete="current-password" required maxLength={128}
          value={password} onChange={event => setPassword(event.target.value)} />
      </label> : <label>Authenticator code
        <input inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6}
          value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} />
      </label>}
      {error && <p role="alert" className="admin-warning">{error}</p>}
      <div className="admin-form-actions">
        <LogoutButton className="admin-button secondary" disabled={busy} onConfirm={onSignOut}>Sign out</LogoutButton>
        <button className="admin-button" disabled={busy}>{busy ? 'Checking…' : needsKey ? 'Get setup key' : 'Verify code'}</button>
      </div>
    </form>
  </div>;
}
