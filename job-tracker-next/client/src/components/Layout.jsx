import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

function Layout() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  function onLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Job Track</h1>
        <p className="welcome">{user ? `Signed in as ${user.name}` : 'Job tracker'}</p>
        <nav>
          <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            Dashboard
          </NavLink>
          <NavLink
            to="/applications"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            Applications
          </NavLink>
        </nav>
        <button className="secondary-button" type="button" onClick={onLogout}>
          Log out
        </button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;