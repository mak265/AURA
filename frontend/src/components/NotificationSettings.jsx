import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import api from '../api/client';
import {
  disableNativePush, enableNativePush, isNativePushEnabled, playNotificationSound,
  unlockNotificationAudio, updateNativePushSound
} from '../notifications';

export default function NotificationSettings({ sound, onSoundChange }) {
  const [config, setConfig] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const platform = Capacitor.getPlatform();
  const supported = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!supported) return;
    let active = true;
    const refreshEnabled = () => setEnabled(isNativePushEnabled());
    window.addEventListener('aura:push-change', refreshEnabled);
    api.get('/notifications/config')
      .then(response => {
        if (!active) return;
        setConfig(response.data);
        setEnabled(isNativePushEnabled());
      })
      .catch(() => { if (active) setError('Could not check push notifications.'); });
    return () => {
      active = false;
      window.removeEventListener('aura:push-change', refreshEnabled);
    };
  }, [supported]);

  async function changePush() {
    setBusy(true);
    setError('');
    try {
      if (enabled) await disableNativePush(true);
      else await enableNativePush(sound, true);
      setEnabled(!enabled);
    } catch (error) {
      setError(error.response?.data?.error || error.message || 'Could not change notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function changeSound() {
    setError('');
    setBusy(true);
    try {
      if (enabled) await updateNativePushSound(!sound);
      onSoundChange(!sound);
    } catch {
      setError('Could not save the notification sound setting.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="settings-card space-y-4">
    <div className="settings-toggle-row">
      <div><h3>Notification sound</h3><p>Play the AURA chime for new activity while you’re using the app.</p></div>
      <button type="button" role="switch" aria-label="Notification sound" aria-checked={sound} disabled={busy}
        className={`settings-switch ${sound ? 'on' : ''}`} onClick={changeSound}><span/></button>
    </div>
    <button type="button" className="text-sm font-medium text-aura-violet-light" onClick={async () => {
      await unlockNotificationAudio();
      playNotificationSound();
    }}>Preview chime</button>
    <div className="settings-toggle-row">
      <div><h3>Push notifications</h3><p>{supported
        ? 'Get alerts for messages, reactions, comments, and replies when the app is in the background.'
        : 'Available in the AURA Android and iOS apps.'}</p></div>
      {supported && <button type="button" role="switch" aria-label="Push notifications" aria-checked={enabled}
        disabled={busy || (!enabled && !config?.[platform])}
        className={`settings-switch ${enabled ? 'on' : ''}`} onClick={changePush}><span/></button>}
    </div>
    {supported && config && !config[platform] && <p className="settings-help">Push provider setup is required for this platform.</p>}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </div>;
}
