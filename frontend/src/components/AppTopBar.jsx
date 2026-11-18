import { BrandMark } from './Brand';
import { Link, useLocation } from 'react-router-dom';
import Icon from './Icon';
import useActivity from '../hooks/useActivity';

export default function AppTopBar({ title, children }) {
  const { unread } = useActivity();
  const { pathname, search } = useLocation();
  return <header className="mobile-topbar">
    <div className="mobile-topbar-title">
      <BrandMark className="mobile-brand-mark" />
      <h1>{title}</h1>
    </div>
    <div className="mobile-topbar-actions">
      <Link to="/activity" state={{ returnTo: pathname + search }} className="mobile-icon-action" aria-label={unread ? `Activity, ${unread} unread` : 'Activity'}>
        <Icon name="bell" size={19}/>
        {unread > 0 && <span className="journal-activity-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </Link>
      {children}
    </div>
  </header>;
}
