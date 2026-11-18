import { useRef } from 'react';
import Icon from './Icon';

const PROMPTS = [
  'What’s a small thing that made your week?',
  'What song feels like your mood today?',
  'What’s one thing you wish people asked you about?',
  'What would your ideal Sunday look like?',
];

export default function PostPrompts({ caption, onChoose, disabled }) {
  const menu = useRef(null);

  return <details ref={menu} className="journal-prompts">
    <summary><Icon name="spark" size={16}/> Try a prompt</summary>
    <div className="mt-1 space-y-1">
      {PROMPTS.map(prompt => {
        const next = [caption.trimEnd(), prompt].filter(Boolean).join('\n\n') + '\n';
        return <button type="button" key={prompt} disabled={disabled || next.length > 5000 || caption.includes(prompt)}
          onClick={() => {
            menu.current.open = false;
            onChoose(next);
          }}>{prompt}</button>;
      })}
    </div>
  </details>;
}
