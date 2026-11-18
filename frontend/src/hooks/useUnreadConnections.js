import { useEffect, useState } from 'react';
import api from '../api/client';

export default function useUnreadConnections(userId, enabled) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!userId || !enabled) return;
    let controller;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const { data } = await api.get('/matches/unread-count', { signal: request.signal, timeout: 5000 });
        if (!request.signal.aborted) setResult({ userId, count: data.count });
      } catch {
        // Keep the previous count until the next successful refresh.
      }
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('aura:unread-change', refresh);
    return () => {
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('aura:unread-change', refresh);
    };
  }, [userId, enabled]);
  return enabled && result?.userId === userId ? result.count : 0;
}
