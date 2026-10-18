import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, Outlet } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { SaydoProvider } from 'saydo-js/react-router';
import { Home } from './home';
import { APP_NAME } from './lib/app-name';
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
          <a href="https://github.com/Ved0715/Saydo" className="ask">
            GitHub
          </a>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </SaydoProvider>
  );
}

const router = createBrowserRouter([{ element: <Layout />, children: [{ path: '/', element: <Home /> }] }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
