import { useEffect } from 'react';
import api from '../api/client';

export function messageStatus(message) {
  return message.read_at ? 'Read' : message.delivered_at ? 'Delivered' : 'Sent';
}
export default function useMessageReceipts(messages, endpoint, myId) {
  useEffect(() => {
    if (!endpoint || !myId) return;
    const acknowledge = async () => {
      const read = document.visibilityState === 'visible';
      const ids = messages.filter(message => message.sender_id !== myId && (!message.delivered_at || (read && !message.read_at))).map(message => message.id);
      // Only acknowledge messages actually received by this conversation screen.
      for (let index = 0; index < ids.length; index += 200) {
        try { await api.post(endpoint, { ids: ids.slice(index, index + 200), read }); }
        catch { break; } // Retry after the next message fetch.
      }
    };
    acknowledge();
    document.addEventListener('visibilitychange', acknowledge);
    return () => document.removeEventListener('visibilitychange', acknowledge);
  }, [messages, endpoint, myId]);
}
