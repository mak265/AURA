import {useAuth} from '../context/AuthContext';
import {preloadPage} from '../pageImports';
import { NavLink } from 'react-router-dom';
import Icon from './Icon';
import { useDeviceSettings } from '../hooks/useDeviceSettings';
import useUnreadConnections from '../hooks/useUnreadConnections';
const items = [
  { path: '/feed', label: 'Journal', icon: 'feed' },
  { path: '/discover', label: 'Discover', icon: 'discover' },
  { path: '/aura-chat', label: 'Meet', icon: 'talk' },
  { path: '/matches', label: 'Connections', icon: 'heart' },
  { path: '/profile', label: 'You', icon: 'profile' },
];
export default function BottomNav() {
  const { user, auraInboxCount = 0 } = useAuth();
  const [device] = useDeviceSettings();
  const unread = useUnreadConnections(user?.user?.id, device.badges);
  return <nav aria-label="Main navigation" className="bottom-nav">{items.map(item => {
    const count = item.path === '/discover' ? auraInboxCount : item.path === '/matches' ? unread : 0;
    const description = item.path === '/matches' ? 'unread conversations' : 'received Auras';
    return <NavLink key={item.path} to={item.path} aria-label={item.label+(count ? `, ${count} ${description}` : '')} onPointerEnter={()=>preloadPage(item.path)} onFocus={()=>preloadPage(item.path)} onPointerDown={()=>preloadPage(item.path)} className={({ isActive }) => 'nav-item' + (isActive ? ' is-active' : '')}>
      <span className="nav-icon-wrap"><Icon name={item.icon}/>{count>0&&<b className="nav-aura-badge" aria-hidden="true">{count>99?'99+':count}</b>}</span><span>{item.label}</span>
    </NavLink>;
  })}</nav>;
}
