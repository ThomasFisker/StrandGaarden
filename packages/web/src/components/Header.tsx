import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { Claims } from '../auth';
import { useProfile } from '../profile';
import {
  canManagePhotos,
  canUploadPhotos,
  canViewDocs,
  effectiveRole,
  ROLE_LABEL,
} from '../permissions';

const primaryRole = (groups: string[]): string => {
  const r = effectiveRole(groups);
  return r ? ROLE_LABEL[r] : '(ingen rolle)';
};

export const Header = ({ claims, onLogout }: { claims: Claims; onLogout: () => void }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useProfile();
  const canUpload = canUploadPhotos(claims);
  const isAdmin = canManagePhotos(claims);
  const showDocs = canViewDocs(claims);
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
            <NavLink
              to="/mine"
              className={() =>
                location.pathname === '/mine' || location.pathname.startsWith('/mine/')
                  ? 'active'
                  : undefined
              }
            >
              Mine billeder
            </NavLink>
          )}
          {showDocs && (
            <NavLink
              to="/dokumenter"
              className={() =>
                location.pathname === '/dokumenter' || location.pathname.startsWith('/dokumenter/')
                  ? 'active'
                  : undefined
              }
            >
              Dokumenter
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
