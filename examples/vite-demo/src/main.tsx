import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, NavLink, Outlet } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { SaydoProvider } from 'saydo-js/react-router';
import { AskButton } from './components/ask-button';
import { APP_NAME } from './lib/app-name';
import { Feedback } from './pages/feedback';
import { Home } from './pages/home';
import { Profile } from './pages/profile';
import { Settings } from './pages/settings';
import './styles.css';

document.title = APP_NAME;

// The provider sits inside the router (it needs useNavigate/useLocation).
function Layout() {
  return (
    <SaydoProvider>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true" />
            {APP_NAME}
          </Link>
          <nav aria-label="Main">
            <NavLink to="/profile">Profile</NavLink>
            <NavLink to="/settings">Settings</NavLink>
            <NavLink to="/feedback">Feedback</NavLink>
          </nav>
          <AskButton />
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="footer">
        <div className="footer-inner">
          <span>
            Built with <a href="https://github.com/Ved0715/Saydo#readme">Saydo</a>
          </span>
          <span>
            Edit <code>src/pages/home.tsx</code> to make this page yours
          </span>
        </div>
      </footer>
    </SaydoProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/profile', element: <Profile /> },
      { path: '/settings', element: <Settings /> },
      { path: '/feedback', element: <Feedback /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
