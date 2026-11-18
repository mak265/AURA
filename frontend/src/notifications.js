import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import api from './api/client';

let audioContext;
export function unlockNotificationAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  audioContext ??= new AudioContext();
  if (audioContext.state === 'suspended') return audioContext.resume().catch(() => {});
}

export function playNotificationSound() {
  if (audioContext?.state !== 'running') return;
  const now = audioContext.currentTime;
  [523.25, 783.99].forEach((frequency, index) => {
    const tone = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = now + index * .075;
    tone.type = 'sine';
    tone.frequency.value = frequency;
    gain.gain.setValueAtTime(.001, start);
    gain.gain.exponentialRampToValueAtTime(.095, start + .018);
    gain.gain.exponentialRampToValueAtTime(.001, start + .19);
    tone.connect(gain).connect(audioContext.destination);
    tone.start(start);
    tone.stop(start + .2);
  });
}

const deviceKey = 'aura_native_push_device';
const promptKey = account => `aura_push_prompted_${account}`;
let registering;

function storedDevice() {
  try { return JSON.parse(localStorage.getItem(deviceKey)); }
  catch { return null; }
}

function currentAccount() {
  try {
    const payload = localStorage.getItem('aura_token').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).userId;
  } catch { return null; }
}

export function isNativePushEnabled() {
  const account = currentAccount();
  return Capacitor.isNativePlatform() && account != null && storedDevice()?.account === account;
}

async function registerNativeDevice(sound, prompt) {
  const platform = Capacitor.getPlatform();
  const account = currentAccount();
  if (account == null) throw new Error('Sign in to enable push notifications.');
  let { receive } = await PushNotifications.checkPermissions();
  if (receive !== 'granted' && prompt) {
    ({ receive } = await PushNotifications.requestPermissions());
  }
  if (receive !== 'granted') throw new Error('Allow AURA notifications in your phone settings.');
  if (platform === 'android') {
    await PushNotifications.createChannel({ id: 'aura_messages_v1', name: 'AURA messages', importance: 4, sound: 'aura_chime.wav' });
    await PushNotifications.createChannel({ id: 'aura_messages_quiet_v1', name: 'AURA messages (quiet)', importance: 2, vibration: false });
  }
  let timer;
  const handles = [];
  try {
    const token = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Could not register this phone for push notifications.')), 12000);
      (async () => {
        handles.push(await PushNotifications.addListener('registration', event => resolve(event.value)));
        handles.push(await PushNotifications.addListener('registrationError', () => reject(new Error('The phone could not register with its push provider.'))));
        await PushNotifications.register();
      })().catch(reject);
    });
    if (currentAccount() !== account) return;
    const device = { platform, token, account };
    const previous = storedDevice();
    await api.put('/notifications/device', { ...device, sound });
    if (currentAccount() !== account) return;
    localStorage.setItem(deviceKey, JSON.stringify(device));
    localStorage.setItem(promptKey(account), 'enabled');
    window.dispatchEvent(new Event('aura:push-change'));
    if (previous && previous.token !== token) {
      await api.delete('/notifications/device', { data: previous }).catch(() => {});
    }
  } finally {
    clearTimeout(timer);
    await Promise.all(handles.map(handle => handle.remove()));
  }
}

export function enableNativePush(sound, prompt = false) {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  const account = currentAccount();
  if (prompt && account != null) localStorage.setItem(promptKey(account), '1');
  registering ??= registerNativeDevice(sound, prompt).finally(() => { registering = null; });
  return registering;
}

export async function enableNativePushOnSignIn(sound) {
  if (isNativePushEnabled()) return enableNativePush(sound);
  if (Capacitor.getPlatform() !== 'android') return;
  const account = currentAccount();
  if (account == null) return;
  const choice = localStorage.getItem(promptKey(account));
  if (choice === 'enabled') return enableNativePush(sound);
  if (choice) return;
  const { data } = await api.get('/notifications/config', { timeout: 8000 });
  if (data.android && currentAccount() === account && !localStorage.getItem(promptKey(account))) {
    await enableNativePush(sound, true);
  }
}

export async function updateNativePushSound(sound) {
  if (!isNativePushEnabled()) return;
  const device = storedDevice();
  if (device) await api.put('/notifications/device', { ...device, sound });
}

export async function disableNativePush(rememberChoice = false) {
  if (!isNativePushEnabled()) return;
  const device = storedDevice();
  if (rememberChoice) localStorage.setItem(promptKey(device.account), '1');
  const token = localStorage.getItem('aura_token');
  if (!device) return;
  try {
    const response = await fetch(`${api.defaults.baseURL}/notifications/device`, {
      method: 'DELETE',
      keepalive: true,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(device)
    });
    if (!response.ok && response.status !== 401) throw new Error('Could not turn off push notifications.');
  } finally {
    localStorage.removeItem(deviceKey);
    window.dispatchEvent(new Event('aura:push-change'));
    await PushNotifications.unregister().catch(() => {});
  }
}
