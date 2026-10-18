'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { SaydoProvider as BaseProvider, type SaydoProviderProps } from '../react/index';

/**
 * App Router–wired provider. Put it in your root layout:
 *
 *   <html><body><SaydoProvider>{children}</SaydoProvider></body></html>
 */
export function SaydoProvider(props: Omit<SaydoProviderProps, 'router' | 'pathname'>) {
  const router = useRouter();
  const pathname = usePathname();
  const adapter = useMemo(
    () => ({
      push: (href: string) => router.push(href),
      replace: (href: string) => router.replace(href),
      refresh: () => router.refresh(),
    }),
    [router],
  );
  return <BaseProvider {...props} router={adapter} pathname={pathname} />;
}

export { useAction, useCapability, useSaydoContext, useSaydo, useSaydoGuard, usePasskeys, useConversations, SaydoApproval, ConfirmCard, AssistantUI } from '../react/index';
