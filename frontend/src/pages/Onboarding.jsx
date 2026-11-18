import { useState } from 'react';
import { Link } from 'react-router-dom';
import Brand from '../components/Brand';
import Icon from '../components/Icon';
import { PROMPTS } from '../connectionOptions';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import './onboarding.css';

export default function Onboarding() {
  const { user, refreshUser } = useAuth();
  const aura = user?.aura;
  const [name, setName] = useState(aura?.aura_name || '');
  const [answers, setAnswers] = useState(() => PROMPTS.map((_, i) => aura?.prompt_answers?.[i] || ''));
  const [prompt, setPrompt] = useState(() => Math.max(0, answers.findIndex(Boolean)));
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(event) {
    event.preventDefault();
    if (!name.trim() || !answers[prompt].trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      // Preserve existing optional profile fields if a returning user revisits this route.
      await api.put('/aura', {
        aura_name: name.trim(), aura_color: aura?.aura_color, emoji: aura?.emoji,
        vibe: aura?.vibe, bio: aura?.bio, prompt_answers: answers,
      });
      await refreshUser();
      setReady(true);
    } catch (error) {
      setError(error.response?.data?.error || 'Couldn’t save your Aura. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return <main className="aura-setup bg-aura-deep">
    <Brand />
    {ready ? <section className="aura-setup-content" aria-labelledby="setup-title">
      <h1 id="setup-title">Your Aura is ready.</h1>
      <p>Choose how you’d like to meet someone.</p>
      <div className="aura-setup-destinations">
        <Link to="/aura-chat"><Icon name="talk"/><span><strong>Meet</strong><small>Start with an anonymous chat or call.</small></span><Icon name="arrow"/></Link>
        <Link to="/discover"><Icon name="discover"/><span><strong>Discover</strong><small>Browse Auras and send one when you’re interested.</small></span><Icon name="arrow"/></Link>
      </div>
      <Link className="aura-setup-edit" to="/profile?edit=1">Add more profile details</Link>
    </section> : <section className="aura-setup-content" aria-labelledby="setup-title">
      <h1 id="setup-title">Create your Aura</h1>
      <p>Choose a name and share one thing someone can ask you about. You can add more details later in You.</p>
      <form onSubmit={save}>
        <label>Aura name<input className="aura-input" required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="The name people see first"/></label>
        <label>Choose a prompt<select className="aura-input" value={prompt} onChange={e => setPrompt(Number(e.target.value))}>
          {PROMPTS.map((text, i) => <option key={text} value={i}>{text}</option>)}
        </select></label>
        <label>Your answer<textarea className="aura-input" rows={3} required maxLength={200} value={answers[prompt]} onChange={e => {
          const value = e.target.value;
          setAnswers(current => current.map((answer, i) => i === prompt ? value : answer));
        }} /></label>
        <small><Icon name="lock" size={14}/> People can see this answer on your Aura.</small>
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="aura-btn-primary" disabled={saving || !name.trim() || !answers[prompt].trim()}>{saving ? 'Saving…' : 'Create my Aura'}</button>
      </form>
    </section>}
  </main>;
}
