import SignupPolicy from './components/SignupPolicy';
import AccountNotices from './components/AccountNotices';
import ModerationNotice from './components/ModerationNotice';
import { lazy, Suspense } from 'react';
import {pageImports} from './pageImports';
import ContentSkeleton from './components/ContentSkeleton';
import BottomNav from './components/BottomNav';
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
const Welcome=lazy(pageImports.Welcome);
const Login=lazy(pageImports.Login);
const Signup=lazy(pageImports.Signup);
const Onboarding=lazy(pageImports.Onboarding);
const Discover=lazy(pageImports.Discover);
const Matches=lazy(pageImports.Matches);
const Chat=lazy(pageImports.Chat);
const AuraChat=lazy(pageImports.AuraChat);
const Profile=lazy(pageImports.Profile);
const ConnectionProfile=lazy(pageImports.ConnectionProfile);
const Feed=lazy(pageImports.Feed);

const Admin=lazy(()=>import('./pages/Admin'));
const Settings=lazy(pageImports.Settings);
function PageLoading(){const {user}=useAuth(),{pathname}=useLocation();return <div className="page-loading min-h-screen pb-24"><div className="page-loading-heading"/><ContentSkeleton/>{user&&['/feed','/discover','/matches','/profile','/aura-chat'].includes(pathname)&&<BottomNav/>}</div>;}
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-aura-deep flex items-center justify-center text-aura-violet-light">
        Loading...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function SoulTalkRoute() {
  const { matchId } = useParams();
  return <AuraChat key={matchId || 'random'} />;
}

function AppRoutes() {
  const {pathname}=useLocation();
  return (
    <Suspense fallback={<PageLoading/>}><div key={pathname} className="route-surface"><Routes>
      <Route path="/" element={<Welcome />} />
      <Route path="/login" element={<Login />} />
      <Route path="/policies" element={<div className="auth-screen min-h-screen px-7 py-10"><a href="/signup">← Sign up</a><SignupPolicy readOnly/></div>} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
      <Route path="/discover" element={<ProtectedRoute><Discover /></ProtectedRoute>} />
      <Route path="/matches" element={<ProtectedRoute><Matches /></ProtectedRoute>} />
      <Route path="/chat/:matchId" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
      <Route path="/aura-chat" element={<ProtectedRoute><SoulTalkRoute /></ProtectedRoute>} />
      <Route path="/aura-chat/:matchId" element={<ProtectedRoute><SoulTalkRoute /></ProtectedRoute>} />
      <Route path="/profile/connection/:matchId" element={<ProtectedRoute><ConnectionProfile /></ProtectedRoute>} />
      <Route path="/admin/*" element={<ProtectedRoute><Admin/></ProtectedRoute>}/>
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route path="/feed" element={<ProtectedRoute><Feed /></ProtectedRoute>} />
    </Routes></div></Suspense>
  );
}

function AppFrame(){const {pathname}=useLocation();return <div className={pathname.startsWith('/admin')?'management-frame':'phone-frame'}><AppRoutes/><ModerationNotice/><AccountNotices/></div>;}
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppFrame/>
      </AuthProvider>
    </BrowserRouter>
  );
}
