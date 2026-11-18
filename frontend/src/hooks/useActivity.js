import { useEffect, useState } from 'react';
import api from '../api/client';

export default function useActivity() {
  const [state, setState] = useState({ items: [], unread: 0, loading: true, error: '' });
  useEffect(() => {
    let request;
    const refresh = async () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      try {
        const { data } = await api.get('/activity', { signal: controller.signal, timeout: 5000 });
        if (!controller.signal.aborted) setState({ ...data, loading: false, error: '' });
      } catch {
        if (!controller.signal.aborted) setState(previous => ({
          ...previous, loading: false, error: 'Couldn’t load notifications.'
        }));
      }
    };
    refresh();
    window.addEventListener('aura:activity-change', refresh);
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      request?.abort();
      window.removeEventListener('aura:activity-change', refresh);
      window.removeEventListener('focus', refresh);
      clearInterval(timer);
    };
  }, []);
  return state;
}
