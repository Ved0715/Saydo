import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, Outlet } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { SaydoProvider } from 'saydo-js/react-router';
import { Feedback } from './pages/feedback';
import { Home } from './pages/home';
import { Profile } from './pages/profile';
import { Settings } from './pages/settings';
import './styles.css';

// The provider sits inside the router (it needs useNavigate/useLocation).
function Layout() {
  return (
    <SaydoProvider>
      <header className="topbar">
        <Link to="/" className="brand">Saydo React</Link>
        <nav aria-label="Main">
          <Link to="/profile">Profile</Link>
          <Link to="/settings">Settings</Link>
          <Link to="/feedback">Feedback</Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
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
