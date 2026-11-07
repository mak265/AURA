import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Keep one GIS instance across StrictMode effects and login/signup navigation.
const state = window.__auraGoogleSignIn ||= { scriptPromise: null, initialized: false, listener: null };

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!state.scriptPromise) {
    state.scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      const timeout = setTimeout(() => {
        script.remove();
        state.scriptPromise = null;
        reject(new Error('Google sign-in took too long to load. Refresh to retry.'));
      }, 15000);
      script.onload = () => {
        clearTimeout(timeout);
        resolve(window.google);
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        state.scriptPromise = null;
        reject(new Error('Unable to load Google sign-in. Check your connection and refresh.'));
      };
      document.head.appendChild(script);
    });
  }
  return state.scriptPromise;
}

export default function GoogleSignInButton() {
  const buttonRef = useRef(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { googleLogin } = useAuth();

  useEffect(() => {
    let active = true;
    let submitting = false;
    const callback = async response => {
      if (!active || submitting) return;
      submitting = true;
      setError('');
      try {
        const data = await googleLogin(response.credential);
        if (active) navigate(data.user.hasAura ? '/discover' : '/onboarding');
      } catch (err) {
        if (active) setError(err.response?.data?.error || 'Google sign-in failed. Please try again.');
      } finally {
        submitting = false;
      }
    };
    state.listener = callback;

    const init = async () => {
      try {
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (!clientId || clientId.includes('your-google-client-id')) throw new Error('Google sign-in is not configured.');
        const google = await loadGoogleScript();
        if (!active || !buttonRef.current) return;
        if (!state.initialized) {
          google.accounts.id.initialize({ client_id: clientId, callback: response => state.listener?.(response) });
          state.initialized = true;
        }
        buttonRef.current.replaceChildren();
        google.accounts.id.renderButton(buttonRef.current, {
          theme: 'outline', size: 'large', width: Math.min(buttonRef.current.offsetWidth || 320, 400), text: 'continue_with',
        });
      } catch (err) {
        if (active) setError(err.message);
      }
    };
    init();
    return () => {
      active = false;
      if (state.listener === callback) state.listener = null;
    };
  }, [googleLogin, navigate]);

  return <div>
    <div ref={buttonRef} className="w-full" />
    {error && <p role="alert" className="text-red-400 text-xs text-center mt-2">{error}</p>}
  </div>;
}
