'use client';
import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useLatest } from './hooks';
import { SaydoProvider as BaseProvider, type SaydoProviderProps } from './provider';

/** Dispatched when an assistant action asks the page to reload its data. */
export const REFRESH_EVENT = 'saydo:refresh';

/**
 * React Router–wired provider. Render it inside your router, for example in
 * the root layout route:
 *
 *   <SaydoProvider><Outlet /></SaydoProvider>
 */
export function SaydoProvider(props: Omit<SaydoProviderProps, 'router' | 'pathname'>) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const router = useMemo(
    () => ({
      push: (href: string) => void navigate(href),
      replace: (href: string) => void navigate(href, { replace: true }),
      refresh: () => window.dispatchEvent(new Event(REFRESH_EVENT)),
    }),
    [navigate],
  );
  return <BaseProvider {...props} router={router} pathname={pathname} />;
}

/** Reload your data when an assistant action changed it (the SPA version of router.refresh()). */
export function useSaydoRefresh(callback: () => void) {
  const onRefresh = useLatest(callback);
  useEffect(() => {
    const handler = () => onRefresh();
    window.addEventListener(REFRESH_EVENT, handler);
    return () => window.removeEventListener(REFRESH_EVENT, handler);
  }, []);
}

export { useAction, useCapability, useSaydoContext, useSaydo, useSaydoGuard, useConversations } from './hooks';
export { usePasskeys } from './webauthn';
export { SaydoApproval } from './approval';
export { AssistantUI, ConfirmCard } from './ui';
