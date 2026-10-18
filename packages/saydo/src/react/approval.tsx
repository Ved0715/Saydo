'use client';
import { useEffect, useState } from 'react';
import type { GrantStatus, InvokeResult, TurnError } from '../core/index';
import { useRuntime } from './context';
import { ConfirmCard } from './ui';

/**
 * The page where a user approves something an external agent (MCP client) asked
 * for. Shows the same server-built card as the in-app assistant: real arguments,
 * trusted click, passkey when required.
 *
 *   // app/saydo/approve/[id]/page.tsx
 *   export { default } from 'saydo/next/approve';
 */
export function SaydoApproval({ grantId }: { grantId: string }) {
  const runtime = useRuntime();
  const [status, setStatus] = useState<GrantStatus | TurnError | null>(null);
  const [outcome, setOutcome] = useState<InvokeResult | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void runtime.call({ type: 'grant-status', grantId }).then((result) => {
      if (live) setStatus((result as GrantStatus | TurnError | null) ?? { ok: false, status: 'error', message: 'Network error.', fix: 'Reload the page.' });
    });
    return () => {
      live = false;
    };
  }, [runtime, grantId]);

  const decide = async (approved: boolean, trusted: boolean, typed?: string) => {
    if (!status?.ok) return;
    setBusy(true);
    setError(undefined);
    try {
      let proof: unknown;
      if (approved && status.stepUp) proof = await (await import('./webauthn')).webauthnProof(status.stepUp);
      const result = (await runtime.call({ type: 'grant-approve', grantId, approved, trusted, typed, proof })) as InvokeResult | null;
      if (result && !result.ok && (result.status === 'invalid_args' || result.status === 'denied') && approved) setError(result.message);
      else setOutcome(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Passkey confirmation was cancelled.');
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <p className="saydo-hint">Loading request…</p>;
  if (!status.ok) return <p role="alert">{status.message}</p>;
  if (outcome) {
    const text = outcome.ok
      ? outcome.status === 'denied'
        ? 'Declined. The agent will be told.'
        : outcome.status === 'needs_approval'
          ? ''
          : `Done: ${outcome.receipt.message ?? outcome.status}. You can return to the agent.`
      : `${outcome.message} ${outcome.fix}`;
    return <p role="status">{text}</p>;
  }
  if (status.state !== 'pending') {
    const label = { approved: 'This request was already approved.', denied: 'This request was declined.', expired: 'This request expired.' }[status.state];
    return <p role="status">{label}</p>;
  }
  return (
    <section aria-label="Approve an agent request">
      <p className="saydo-hint">{status.origin === 'browser-agent' ? 'A browser agent' : 'An AI agent connected to your account'} asked to do this on your behalf.</p>
      <ConfirmCard
        confirm={{
          type: 'confirm',
          toolCallId: '',
          grantId,
          capability: status.capability,
          view: status.view!,
          tier: status.tier,
          expiresAt: status.expiresAt,
          stepUp: status.stepUp,
          stepUpMissing: status.stepUpMissing,
        }}
        error={error}
        busy={busy}
        onApprove={(trusted, typed) => void decide(true, trusted, typed)}
        onDeny={() => void decide(false, true)}
      />
    </section>
  );
}
