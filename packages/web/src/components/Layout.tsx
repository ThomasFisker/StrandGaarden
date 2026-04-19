import { Outlet } from 'react-router-dom';
import { useSession } from '../session';
import { Header } from './Header';

export const Layout = () => {
  const { session, signOut } = useSession();
  return (
    <>
      {session && <Header claims={session.claims} onLogout={signOut} />}
      <Outlet />
    </>
  );
};
