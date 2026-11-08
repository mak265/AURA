import SignupPolicy from '../components/SignupPolicy';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import GoogleSignInButton from '../components/GoogleSignInButton';

export default function Signup() {
  const [policyConsent, setPolicyConsent] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { signup } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await signup(email, password, confirmPassword, policyConsent);
      navigate('/onboarding');
    } catch (err) {
      setError(err.response?.data?.error || 'Signup failed.');
    } finally {
      setLoading(false);
    }
  };

  if (!policyConsent) return <div className="auth-screen min-h-screen px-7 py-10"><button onClick={()=>navigate('/')} className="mb-8">← Back</button><SignupPolicy onContinue={setPolicyConsent}/><p className="text-center mt-6">Already a member? <button onClick={()=>navigate('/login')}>Log in</button></p></div>;
  return (
    <div className="auth-screen min-h-screen bg-aura-deep flex flex-col px-7 py-10">
      <button onClick={() => navigate('/')} className="text-aura-violet-light mb-8 self-start">←  Back</button>
      <h1 className="auth-title">Create account</h1>
      <p className="text-gray-400 text-sm mt-1">Join AURA and meet the vibe before the face.</p>

      <button className="policy-review-link" onClick={()=>setPolicyConsent(null)}>Review policies & age confirmation</button>
      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
        <div>
          <label htmlFor="email" className="text-xs font-semibold text-gray-400 mb-2 block">EMAIL</label>
          <input
            id="email" autoComplete="email" type="email"
            className="aura-input"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="text-xs font-semibold text-gray-400 mb-2 block">PASSWORD</label>
          <input
            id="password" autoComplete="new-password" type="password"
            className="aura-input"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            required
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className="text-xs font-semibold text-gray-400 mb-2 block">CONFIRM PASSWORD</label>
          <input
            id="confirm-password" autoComplete="new-password" type="password"
            className="aura-input"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            required
          />
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button type="submit" className="aura-btn-primary mt-2" disabled={loading}>
          {loading ? 'Creating...' : 'Sign Up'}
        </button>
      </form>

      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px bg-aura-border" />
        <span className="text-xs text-gray-500">OR</span>
        <div className="flex-1 h-px bg-aura-border" />
      </div>

      <GoogleSignInButton policyConsent={policyConsent} />

      <p className="text-center text-sm text-gray-400 mt-6">
        Already have an account?{' '}
        <button onClick={() => navigate('/login')} className="text-aura-violet-light font-semibold">Log in</button>
      </p>
    </div>
  );
}
