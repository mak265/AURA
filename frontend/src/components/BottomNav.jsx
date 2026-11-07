import {preloadPage} from '../pageImports';
import { NavLink } from 'react-router-dom';
import Icon from './Icon';
const items = [
  { path: '/feed', label: 'Journal', icon: 'feed' },
  { path: '/discover', label: 'Discover', icon: 'discover' },
  { path: '/aura-chat', label: 'Soul Talk', icon: 'talk' },
  { path: '/matches', label: 'Connections', icon: 'heart' },
  { path: '/profile', label: 'You', icon: 'profile' },
];
export default function BottomNav() {
  return <nav aria-label="Main navigation" className="bottom-nav">{items.map(item =>
    <NavLink key={item.path} to={item.path} onPointerEnter={()=>preloadPage(item.path)} onFocus={()=>preloadPage(item.path)} onPointerDown={()=>preloadPage(item.path)} className={({ isActive }) => 'nav-item' + (isActive ? ' is-active' : '')}>
      <Icon name={item.icon}/><span>{item.label}</span>
    </NavLink>
  )}</nav>;
}
