import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import Brand from '../components/Brand';

export default function Welcome() {
  return <main className="welcome-screen">
    <header className="welcome-brand"><Brand /></header>
    <div className="welcome-content">
      <div className="welcome-story">
        <h1>Start with a<br /><em>conversation.</em></h1>
        <p className="welcome-description">Meet someone new over chat or voice. Reveal who you are when you’re both ready.</p>
      </div>
      <div className="welcome-actions">
        <Link className="welcome-link welcome-link-primary" to="/signup">Create account <Icon name="arrow" size={18} /></Link>
        <Link className="welcome-link welcome-link-secondary" to="/login">Sign in</Link>
      </div>
    </div>
    <div className="welcome-preview" aria-hidden="true">
      <div className="welcome-chat">
        <div className="welcome-chat-header">
          <span className="welcome-chat-avatar"><Icon name="talk" size={19} /></span>
          <div><strong>Anonymous chat</strong><span><Icon name="lock" size={12} /> Identity hidden</span></div>
        </div>
        <p className="welcome-message">What’s your perfect Sunday?</p>
        <p className="welcome-message welcome-message-reply">Coffee, rain, and no plans.</p>
        <p className="welcome-message welcome-message-last">Okay, we’d get along.</p>
      </div>
    </div>
  </main>;
}
