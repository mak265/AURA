import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import GoogleSignInButton from '../components/GoogleSignInButton';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(email, password);
      if(['staff','admin','superadmin'].includes(data.user.management_role)){navigate('/admin');}
      else if (data.user.hasAura) {
        navigate('/discover');
      } else {
        navigate('/onboarding');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen min-h-screen bg-aura-deep flex flex-col px-7 py-10">
      <button onClick={() => navigate('/')} className="text-aura-violet-light mb-8 self-start">←  Back</button>
      <h1 className="auth-title">Welcome back.</h1>
      <p className="text-gray-400 text-sm mt-1">Good conversations are waiting for you.</p>

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
            id="password" autoComplete="current-password" type="password"
            className="aura-input"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input
            type="checkbox"
            checked={remember}
            onChange={e => setRemember(e.target.checked)}
            className="accent-aura-violet"
          />
          Remember me
        </label>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button type="submit" className="aura-btn-primary mt-2" disabled={loading}>
          {loading ? 'Logging in...' : 'Log In'}
        </button>
      </form>

      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px bg-aura-border" />
        <span className="text-xs text-gray-500">OR</span>
        <div className="flex-1 h-px bg-aura-border" />
      </div>

      <GoogleSignInButton />

      <p className="text-center text-sm text-gray-400 mt-6">
        Don't have an account?{' '}
        <button onClick={() => navigate('/signup')} className="text-aura-violet-light font-semibold">Sign up</button>
      </p>
    </div>
  );
}
