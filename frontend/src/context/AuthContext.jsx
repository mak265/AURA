import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { disableNativePush } from '../notifications';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
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

  const [auraInbox,setAuraInbox]=useState({userId:null,count:0});
  const auraInboxCount=auraInbox.userId===userId?auraInbox.count:0;
  useEffect(()=>{
    if(!userId)return;
    let active=true,polling=false;
    const load=async()=>{if(polling||document.visibilityState!=='visible')return;polling=true;try{const {data}=await api.get('/discover/auras/count',{timeout:5000});if(active)setAuraInbox({userId,count:data.count||0});}catch{/* Keep the last count during temporary connection loss. */}finally{polling=false;}};
    load();const timer=setInterval(load,10000);
    document.addEventListener('visibilitychange',load);window.addEventListener('aura:inbox-change',load);
    return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',load);window.removeEventListener('aura:inbox-change',load);};
  },[userId]);

  const restoreSession = useCallback(async () => {
    const token = localStorage.getItem('aura_token');
    setSessionUnavailable(false);
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get('/aura/me', { timeout: 10000 });
      setUser(data);
    } catch {
      setSessionUnavailable(localStorage.getItem('aura_token') === token);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { restoreSession(); }, [restoreSession]);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    sessionStorage.removeItem('aura_management_token');
    localStorage.setItem('aura_token', res.data.token);
    setUser({ user: res.data.user });
    return res.data;
  };

  const signup = async (email, password, confirmPassword, policyConsent, workStatus) => {
    const res = await api.post('/auth/signup', { email, password, confirmPassword, policyConsent, workStatus });
    localStorage.setItem('aura_token', res.data.token);
    setUser({ user: res.data.user });
    return res.data;
  };

  const googleLogin = useCallback(async (tokenId, policyConsent, workStatus) => {
    const res = await api.post('/auth/google', { tokenId, policyConsent, workStatus });
    localStorage.setItem('aura_token', res.data.token);
    setUser({ user: res.data.user });
    return res.data;
  }, []);

  const logout = () => {
    sessionStorage.removeItem('aura_management_token');
    const token = localStorage.getItem('aura_token');
    disableNativePush().catch(() => {}).then(() => {
      if (token) return fetch(`${api.defaults.baseURL}/auth/sessions/current`, {
        method: 'DELETE', keepalive: true, headers: { Authorization: `Bearer ${token}` },
      });
    }).catch(() => {});
    localStorage.removeItem('aura_token');
    setUser(null);
  };

  const refreshUser = async () => {
    const res = await api.get('/aura/me');
    setUser(res.data);
    return res.data;
  };

  return (
    <AuthContext.Provider value={{ user, loading, sessionUnavailable, restoreSession, login, signup, googleLogin, logout, refreshUser, auraInboxCount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
