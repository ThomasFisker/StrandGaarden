import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { Claims } from '../auth';
import { useProfile } from '../profile';

const primaryRole = (groups: string[]): string => {
  if (groups.includes('admin')) return 'Administrator';
  if (groups.includes('member')) return 'Medlem';
  if (groups.includes('viewer')) return 'Kigger';
  return '(ingen rolle)';
};

export const Header = ({ claims, onLogout }: { claims: Claims; onLogout: () => void }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useProfile();
  const canUpload = claims.groups.some((g) => g === 'admin' || g === 'member');
  const isAdmin = claims.groups.includes('admin');
  // Gallery stays visible for admins always; for non-admins we hide it in
  // stages 1+2 where the gallery isn't the audience-facing experience.
  // While the profile is still loading we keep it visible so the link
  // doesn't flicker for the (common) Stage-3 case.
  const showGallery = isAdmin || profile === null || profile.stage === 3;
  const onAdminSection =
    location.pathname === '/admin' ||
    location.pathname === '/review' ||
    location.pathname.startsWith('/admin/');
  return (
    <header className="site">
      <div className="site-inner">
        <a href="/" className="wordmark">
          Strandgaarden <em>100 år</em>
        </a>
        <nav className="primary">
          {showGallery && (
            <NavLink to="/galleri" className={({ isActive }) => (isActive ? 'active' : undefined)}>
              Galleri
            </NavLink>
          )}
          {canUpload && (
            <NavLink to="/upload" className={({ isActive }) => (isActive ? 'active' : undefined)}>
              Upload billede
            </NavLink>
          )}
          {canUpload && (
            <NavLink to="/mine" className={({ isActive }) => (isActive ? 'active' : undefined)}>
              Mine billeder
            </NavLink>
          )}
          {isAdmin && (
            <NavLink
              to="/admin"
              className={() => (onAdminSection ? 'active' : undefined)}
            >
              Udvalget
            </NavLink>
          )}
        </nav>
        <div className="me">
          <span>{claims.loginName ?? claims.email ?? 'ukendt'}</span>
          <span className="role-badge">{primaryRole(claims.groups)}</span>
          <button
            onClick={() => {
              onLogout();
              navigate('/login', { replace: true });
            }}
          >
            Log ud
          </button>
        </div>
      </div>
    </header>
  );
};
