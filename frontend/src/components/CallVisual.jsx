import Icon from './Icon';

export function formatCallDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export default function CallVisual({ phase }) {
  return <div className={`farming-call-orb call-orb call-orb--${phase}`} aria-hidden="true">
    <Icon name="phone" size={38}/>
    {phase === 'connected' && <span className="call-wave"><i/><i/><i/><i/><i/></span>}
  </div>;
}
