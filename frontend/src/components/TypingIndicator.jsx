export default function TypingIndicator({name='Your connection',visible}) {
  return <div className={`typing-slot ${visible?'is-typing':''}`} aria-hidden={!visible}>
    {visible&&<div className="typing-indicator" role="status" aria-label={`${name} is typing`}><span className="typing-dots" aria-hidden="true"><i/><i/><i/></span><span className="typing-label">{name} is typing</span></div>}
  </div>;
}
