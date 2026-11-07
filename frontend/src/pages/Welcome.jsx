import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
export default function Welcome() {
  const navigate = useNavigate();
  return <main className="welcome-screen">
    <header className="welcome-brand"><span className="brand-wordmark">aura<span className="brand-dot">.</span></span><span className="eyebrow">A deeper kind of dating</span></header>
    <div className="welcome-story">
      <div className="connection-art" aria-hidden="true"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><span className="art-caption">The beginning of something real.</span><span className="art-star">+</span></div>
      <p className="eyebrow">Personality first. Always.</p>
      <h1>Some connections<br/>are <em>felt first.</em></h1>
      <p className="welcome-description">A little mystery. An honest conversation.<br/>Meet the person before the profile picture.</p>
    </div>
    <div className="welcome-actions">
      <button className="aura-btn-primary flex items-center justify-between" onClick={() => navigate('/signup')}>Find your connection <Icon name="arrow"/></button>
      <p className="text-sm text-center text-gray-400 mt-5">Already here? <button className="text-white ml-1 underline underline-offset-4" onClick={() => navigate('/login')}>Sign in</button></p>
      <p className="welcome-footnote"><Icon name="lock" size={12}/> Your identity, revealed on your terms.</p>
    </div>
  </main>;
}
