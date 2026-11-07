const reactionTypes = new Set(['like', 'love', 'care', 'haha', 'wow', 'sad', 'angry']);

export default function ReactionIcon({ type = 'like', size = 24, muted = false }) {
  const reaction = reactionTypes.has(type) ? type : 'like';
  return <img
    src={`/reactions/apple/${reaction}.png`}
    alt=""
    aria-hidden="true"
    width={size}
    height={size}
    draggable={false}
    style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', userSelect: 'none', opacity: muted ? .75 : 1 }}
  />;
}
