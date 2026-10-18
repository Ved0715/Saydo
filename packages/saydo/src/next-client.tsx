'use client';
// Explicit re-exports: Next.js does not allow `export *` across a client boundary.
export {
  SaydoProvider,
  AssistantUI,
  ConfirmCard,
  useAction,
  useCapability,
  useSaydoContext,
  useSaydo,
  useSaydoGuard,
  usePasskeys,
  useConversations,
  SaydoApproval,
} from './next/client';
