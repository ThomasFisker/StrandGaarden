import { NavLink, useNavigate } from 'react-router-dom';
import type { Claims } from '../auth';

const primaryRole = (groups: string[]): string => {
  if (groups.includes('admin')) return 'Administrator';
  if (groups.includes('member')) return 'Medlem';
  if (groups.includes('viewer')) return 'Kigger';
  return '(ingen rolle)';
};

export const Header = ({ claims, onLogout }: { claims: Claims; onLogout: () => void }) => {
  const navigate = useNavigate();
  const canUpload = claims.groups.some((g) => g === 'admin' || g === 'member');
  const isAdmin = claims.groups.includes('admin');
  return (
    <header className="site">
      <div className="inner">
        <a href="/" className="brand">Strandgaarden 100 år</a>
        <nav>
          <NavLink to="/galleri" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Galleri
          </NavLink>
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
            <NavLink to="/review" className={({ isActive }) => (isActive ? 'active' : undefined)}>
              Gennemgang
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin/users" className={({ isActive }) => (isActive ? 'active' : undefined)}>
              Brugere
            </NavLink>
          )}
        </nav>
        <div className="me">
          <span>{claims.email ?? 'ukendt'}</span>
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
