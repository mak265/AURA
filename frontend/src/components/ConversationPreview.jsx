import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Avatar from './Avatar';

function previewText(message) {
  if (message.unsent_at) return 'Message unsent';
  if (message.kind === 'image') return message.content ? `Photo · ${message.content}` : 'Photo';
  if (message.kind === 'audio') return 'Voice message';
  return message.content;
}

export default function ConversationPreview({ conversation, onClose }) {
  const { user } = useAuth();
  const dialog = useRef(null);
  const history = useRef(null);
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(false);
  const name = conversation.aura_name || 'Aura';

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    const controller = new AbortController();
    element.showModal();
    if (conversation.soul_game_completed) {
      api.get(`/matches/${conversation.id}/messages`, { params: { preview: 1 }, signal: controller.signal })
        .then(({ data }) => { if (!controller.signal.aborted) setMessages(data); })
        .catch(() => { if (!controller.signal.aborted) setError(true); });
    }
    return () => {
      controller.abort();
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [conversation.id, conversation.soul_game_completed]);

  useLayoutEffect(() => {
    if (history.current) history.current.scrollTop = history.current.scrollHeight;
  }, [messages]);

  return createPortal(<dialog ref={dialog} className="conversation-preview"
    aria-labelledby="conversation-preview-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="conversation-preview-card">
      <header>
        <Avatar src={conversation.profile_photo} name={name} size={36}/>
        <div><h2 id="conversation-preview-title">{name}</h2><p>Conversation preview</p></div>
        <button type="button" aria-label="Close preview" onClick={onClose}>×</button>
      </header>
      <div ref={history} className="conversation-preview-history">
        {messages?.length ? messages.map(message => <p key={message.id}
          className={`conversation-preview-bubble ${message.sender_id === user?.user?.id ? 'is-mine' : ''}`}>
          {previewText(message)}
        </p>) : <p className="conversation-preview-status" role="status">
          {!conversation.soul_game_completed ? 'Start an anonymous chat in Meet to unlock this conversation.' :
            error ? 'Couldn’t load the conversation.' : messages ? 'No messages yet.' : 'Loading messages…'}
        </p>}
      </div>
    </div>
  </dialog>, document.body);
}
