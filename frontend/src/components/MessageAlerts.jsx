import { useEffect, useEffectEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import io from 'socket.io-client';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getDeviceSettings } from '../hooks/useDeviceSettings';
import { enableNativePushOnSignIn, playNotificationSound, unlockNotificationAudio } from '../notifications';
import { isLoungeInvite } from '../loungeInvite';

function isAlertPath(path) {
  return typeof path === 'string' && (path === '/matches/management' || /^\/chat\/\d+$/.test(path)
    || /^\/feed\?post=\d+(&comments=1)?$/.test(path) || /^\/feed\?glimpse=\d+$/.test(path)
    || /^\/discover\?aura=\d+$/.test(path) || /^\/aura-chat\?session=\d+$/.test(path) || isLoungeInvite(path));
}

export default function MessageAlerts() {
  const { user } = useAuth();
  const userId = user?.user?.id;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [alert, setAlert] = useState(null);
  const openNotification = useEffectEvent(({ notification }) => {
    const path = notification.data?.path;
    if (isAlertPath(path)) navigate(path);
  });

  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;
    const listener = PushNotifications.addListener('pushNotificationActionPerformed', event => openNotification(event));
    enableNativePushOnSignIn(getDeviceSettings().messageSound).catch(() => {});
    return () => { listener.then(handle => handle.remove()).catch(() => {}); };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    window.addEventListener('pointerdown', unlockNotificationAudio);
    window.addEventListener('keydown', unlockNotificationAudio);
    const socket = io(new URL(api.defaults.baseURL, window.location.origin).origin, {
      auth: { token: localStorage.getItem('aura_token') }
    });
    const showAlert = ({ path, body = 'New AURA message' }) => {
      if (!isAlertPath(path) || document.visibilityState !== 'visible' ||
          (!Capacitor.isNativePlatform() && !document.hasFocus())) return;
      if (getDeviceSettings().messageSound) playNotificationSound();
      if (path !== pathname) setAlert({ path, body });
    };
    socket.on('alert:message', alert => {
      window.dispatchEvent(new Event('aura:unread-change'));
      showAlert(alert);
    });
    socket.on('alert:activity', alert => {
      window.dispatchEvent(new Event('aura:activity-change'));
      if (alert.path?.startsWith('/discover?aura=')) window.dispatchEvent(new Event('aura:inbox-change'));
      if (alert.path?.startsWith('/aura-chat?session=')) window.dispatchEvent(new Event('aura:meet-reminder'));
      if (isLoungeInvite(alert.path)) window.dispatchEvent(new Event('aura:unread-change'));
      if (alert.path === '/matches/management') {
        window.dispatchEvent(new Event('aura:management-change'));
        window.dispatchEvent(new Event('aura:unread-change'));
      }
      showAlert(alert);
    });
    return () => {
      socket.disconnect();
      window.removeEventListener('pointerdown', unlockNotificationAudio);
      window.removeEventListener('keydown', unlockNotificationAudio);
    };
  }, [userId, pathname]);

  useEffect(() => {
    if (!alert) return;
    const timer = setTimeout(() => setAlert(null), 5000);
    return () => clearTimeout(timer);
  }, [alert]);

  if (!userId || !alert || pathname === alert.path) return null;
  return <div className="aura-message-alert" role="status">
    <Link to={alert.path} onClick={() => setAlert(null)}>{alert.body} <span aria-hidden="true">→</span></Link>
    <button type="button" aria-label="Dismiss notification" onClick={() => setAlert(null)}>×</button>
  </div>;
}
