import type { Receipt, ReceiptStatus } from './types';

/**
 * Rule 6 of the DX contract: every receipt status ships with a fix. The model
 * reads these to decide what to do next, so they are phrased as instructions.
 */
export const DEFAULT_FIXES: Record<ReceiptStatus, string> = {
  ok: 'Tell the user briefly what happened.',
  needs_confirmation:
    'Tell the user to review the confirmation card. Do not call the tool again.',
  denied: 'The user or policy declined. Acknowledge it and do not retry.',
  expired: 'The confirmation expired. Ask the user if they still want to do this.',
  cancelled: 'The user moved on. Respond to their latest message instead.',
  invalid_args: 'Correct the arguments to match the tool schema, then retry once.',
  not_found:
    'The referenced item does not exist or is not accessible. Use entities_find or ask the user which item they mean.',
  forbidden: 'The user is not allowed to do this. Explain that and do not retry.',
  precondition_failed: 'Explain the reason to the user. Do not retry unchanged.',
  not_ready:
    'That action is not available on the current page. Navigate to where it lives first, or ask the user.',
  blocked: 'Something on the page is blocking this (for example unsaved changes). Tell the user.',
  timeout: 'The action took too long. Tell the user and do not retry automatically.',
  reload_required: 'The app was updated. Ask the user to reload the page.',
  loop_detected: 'Stop repeating this call. Summarize what happened for the user.',
  error: 'The action failed. Tell the user; do not retry.',
};

export function receipt(status: ReceiptStatus, extra: Omit<Receipt, 'status'> = {}): Receipt {
  return { status, fix: DEFAULT_FIXES[status], ...extra };
}

/**
 * Throw from a capability handler to return a structured, model-safe failure.
 * The `hint` is shown to the model; it must be authored text, not user content.
 */
export class CapabilityError extends Error {
  constructor(
    readonly status: Exclude<ReceiptStatus, 'ok' | 'needs_confirmation'>,
    readonly hint: string,
    readonly code?: string,
  ) {
    super(hint);
    this.name = 'CapabilityError';
  }
}
