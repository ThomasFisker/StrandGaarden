import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../session';
import { GdprGate } from './GdprGate';
import type { CognitoGroup } from '../permissions';

/**
 * Gate child routes behind authentication and (optionally) group
 * membership.
 *
 * - `requireGroup` — single Cognito group; passes if the caller belongs
 *   to it. Kept for back-compat with existing call sites.
 * - `requireAny` — array of groups; passes if the caller belongs to
 *   ANY of them. Use this for routes that accept multiple roles
 *   (e.g. `requireAny={['board', 'administrator']}` for board admin).
 *
 * If both are provided, the caller must satisfy both. If neither is
 * provided, any authed user passes.
 */
interface ProtectedRouteProps {
  requireGroup?: CognitoGroup;
  requireAny?: CognitoGroup[];
}

export const ProtectedRoute = ({ requireGroup, requireAny }: ProtectedRouteProps) => {
  const { session, loading } = useSession();
  const location = useLocation();

  if (loading) return <main className="content"><p>Indlæser…</p></main>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const groups = session.claims.groups;
  const failsSingle = requireGroup !== undefined && !groups.includes(requireGroup);
  const failsAny = requireAny !== undefined && !requireAny.some((g) => groups.includes(g));
  if (failsSingle || failsAny) {
    return (
      <main className="content">
        <h1>Ingen adgang</h1>
        <p>Du har ikke de rette rettigheder til at se denne side.</p>
      </main>
    );
  }

  return (
    <GdprGate>
      <Outlet />
    </GdprGate>
  );
};
