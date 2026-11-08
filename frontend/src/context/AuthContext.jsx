import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [presenceSession] = useState(()=>crypto.randomUUID());
  const userId=user?.user?.id;
  useEffect(()=>{
    if(!userId)return;
    const token=localStorage.getItem('aura_token');
    const update=active=>{
      fetch(`${api.defaults.baseURL}/profile/presence`,{method:'POST',keepalive:true,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sessionId:presenceSession,active})}).catch(()=>{});
    };
    const heartbeat=()=>update(document.visibilityState==='visible');
    const leave=()=>update(false);
    heartbeat();const timer=setInterval(()=>{if(document.visibilityState==='visible')update(true);},20000);
    document.addEventListener('visibilitychange',heartbeat);window.addEventListener('pagehide',leave);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',heartbeat);window.removeEventListener('pagehide',leave);leave();};
  },[userId,presenceSession]);

  useEffect(() => {
    const token = localStorage.getItem('aura_token');
    if (token) {
      api.get('/aura/me')
        .then(res => {
          setUser(res.data);
        })
        .catch(() => {
          localStorage.removeItem('aura_token');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('aura_token', res.data.token);
    setUser({ user: res.data.user });
    return res.data;
  };

  const signup = async (email, password, confirmPassword, policyConsent) => {
    const res = await api.post('/auth/signup', { email, password, confirmPassword, policyConsent });
    localStorage.setItem('aura_token', res.data.token);
    setUser({ user: res.data.user });
    return res.data;
  };

  const googleLogin = useCallback(async (tokenId, policyConsent) => {
    const res = await api.post('/auth/google', { tokenId, policyConsent });
    localStorage.setItem('aura_token', res.data.token);
    setUser({ user: res.data.user });
    return res.data;
  }, []);

  const logout = () => {
    localStorage.removeItem('aura_token');
    setUser(null);
  };

  const refreshUser = async () => {
    const res = await api.get('/aura/me');
    setUser(res.data);
    return res.data;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, googleLogin, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
