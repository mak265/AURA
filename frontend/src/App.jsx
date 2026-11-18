import SignupPolicy from './components/SignupPolicy';
import AccountNotices from './components/AccountNotices';
import MessageAlerts from './components/MessageAlerts';
import ModerationNotice from './components/ModerationNotice';
import { lazy, Suspense, useRef, useState } from 'react';
import {pageImports} from './pageImports';
import ContentSkeleton from './components/ContentSkeleton';
import BottomNav from './components/BottomNav';
import { ConnectionCallProvider } from './components/ConnectionCallProvider';
import { BrowserRouter, Routes, Route, Navigate, Link, useParams, useLocation, useMatch } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import useAppViewport from './hooks/useAppViewport';
import useTabScroll from './hooks/useTabScroll';
import './app-shell.css';
const Welcome=lazy(pageImports.Welcome);
const Login=lazy(pageImports.Login);
const Signup=lazy(pageImports.Signup);
const Onboarding=lazy(pageImports.Onboarding);
const Discover=lazy(pageImports.Discover);
const Matches=lazy(pageImports.Matches);
const Chat=lazy(pageImports.Chat);
const AuraChat=lazy(pageImports.AuraChat);
const AuraLounge=lazy(()=>import('./pages/AuraLounge'));
const Profile=lazy(pageImports.Profile);
const ConnectionProfile=lazy(pageImports.ConnectionProfile);
const Feed=lazy(pageImports.Feed);
const JournalActivity=lazy(()=>import('./pages/JournalActivity'));

const Admin=lazy(()=>import('./pages/Admin'));
const ManagementInbox=lazy(()=>import('./components/ManagementInbox'));
const Settings=lazy(pageImports.Settings);
const tabs = new Set(['/feed', '/discover', '/aura-chat', '/matches', '/profile']);
function PageLoading(){return <div className="page-loading min-h-screen"><div className="page-loading-heading"/><ContentSkeleton/></div>;}
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

function SoulTalkRoute({ visible }) {
  const { matchId } = useParams();
  return <AuraChat key={matchId || 'random'} visible={visible} />;
}

function FarmingSurface() {
  const { pathname, search } = useLocation();
  const currentPath = pathname + search;
  const visible = Boolean(useMatch('/aura-chat/:matchId?'));
  const [lastPath, setLastPath] = useState(visible ? currentPath : null);
  if (visible && lastPath !== currentPath) setLastPath(currentPath);
  if (!visible && !lastPath) return null;
  return <div hidden={!visible}>
    <Suspense fallback={visible ? <PageLoading/> : null}>
      <Routes location={visible ? currentPath : lastPath}>
        <Route path="/aura-chat/:matchId?" element={<SoulTalkRoute visible={visible}/>}/>
      </Routes>
    </Suspense>
  </div>;
}

function LoungeSurface() {
  const visible = Boolean(useMatch('/aura-lounge'));
  const [visited, setVisited] = useState(visible);
  if (visible && !visited) setVisited(true);
  if (!visible && !visited) return null;
  return <Suspense fallback={visible ? <PageLoading/> : null}>
    <AuraLounge visible={visible}/>
  </Suspense>;
}

function AppRoutes() {
  const {pathname}=useLocation();
  const { user, loading, sessionUnavailable, restoreSession } = useAuth();
  if (loading) return <PageLoading/>;
  if (sessionUnavailable) return <div className="px-7 py-10 space-y-4" role="alert">
    <p>Can’t reach AURA right now. Check your connection and try again.</p>
    <button className="aura-btn-primary" onClick={restoreSession}>Try again</button>
  </div>;
  if (user && ['/', '/login', '/signup'].includes(pathname)) {
    const destination = ['staff', 'admin', 'superadmin'].includes(user.user.management_role)
      ? '/admin' : (user.aura || user.user.hasAura) ? '/discover' : '/onboarding';
    return <Navigate to={destination} replace/>;
  }
  return (
    <Suspense fallback={<PageLoading/>}><div key={pathname} className="route-surface"><Routes>
      <Route path="/" element={<Welcome />} />
      <Route path="/login" element={<Login />} />
      <Route path="/policies" element={<div className="auth-screen min-h-screen px-7 py-10"><Link to="/signup">← Sign up</Link><SignupPolicy readOnly/></div>} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
      <Route path="/discover" element={<ProtectedRoute><Discover /></ProtectedRoute>} />
      <Route path="/matches" element={<ProtectedRoute><Matches /></ProtectedRoute>} />
      <Route path="/matches/management" element={<ProtectedRoute><ManagementInbox /></ProtectedRoute>} />
      <Route path="/chat/:matchId" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
      <Route path="/aura-chat/:matchId?" element={<ProtectedRoute>{null}</ProtectedRoute>} />
      <Route path="/aura-lounge" element={<ProtectedRoute>{null}</ProtectedRoute>} />
      <Route path="/profile/connection/:matchId" element={<ProtectedRoute><ConnectionProfile /></ProtectedRoute>} />
      <Route path="/admin/*" element={<ProtectedRoute><Admin/></ProtectedRoute>}/>
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route path="/feed" element={<ProtectedRoute><Feed /></ProtectedRoute>} />
      <Route path="/activity" element={<ProtectedRoute><JournalActivity /></ProtectedRoute>} />
      <Route path="/feed/activity" element={<Navigate to="/activity" replace />} />
    </Routes></div></Suspense>
  );
}

function AppFrame() {
  const { pathname, search } = useLocation();
  const { user } = useAuth();
  const myId = user?.user?.id;
  const management = pathname.startsWith('/admin');
  const inApp = Boolean(myId && !management && !['/', '/login', '/signup', '/onboarding', '/policies'].includes(pathname));
  const showTabs = inApp && tabs.has(pathname);
  const frameRef = useRef(null);
  const stageRef = useRef(null);
  useAppViewport(frameRef, inApp);
  useTabScroll(stageRef, myId, pathname, showTabs, search);

  return <div ref={frameRef} className={management ? 'management-frame' : `phone-frame${inApp ? ' aura-app-shell' : ''}`}>
    <ConnectionCallProvider key={myId} myId={myId}>
      <div ref={stageRef} className="aura-app-stage">
        <div className="aura-app-stage-content">
          <AppRoutes/>
          {myId && <FarmingSurface/>}
          {myId && <LoungeSurface/>}
        </div>
      </div>
      {showTabs && <BottomNav/>}
    </ConnectionCallProvider>
    <ModerationNotice/><AccountNotices/><MessageAlerts/>
  </div>;
}
export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <ThemeProvider><AuthProvider><AppFrame/></AuthProvider></ThemeProvider>
    </BrowserRouter>
  );
}
