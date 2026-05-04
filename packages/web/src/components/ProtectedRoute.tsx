import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ProfileProvider } from '../profile';
import { useSession } from '../session';
import { GdprGate } from './GdprGate';

export const ProtectedRoute = ({ requireGroup }: { requireGroup?: 'admin' | 'member' | 'viewer' }) => {
  const { session, loading } = useSession();
  const location = useLocation();

  if (loading) return <main className="content"><p>Indlæser…</p></main>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  if (requireGroup && !session.claims.groups.includes(requireGroup)) {
    return (
      <main className="content">
        <h1>Ingen adgang</h1>
        <p>Du har ikke de rette rettigheder til at se denne side.</p>
      </main>
    );
  }

  return (
    <ProfileProvider>
      <GdprGate>
        <Outlet />
      </GdprGate>
    </ProfileProvider>
  );
};
