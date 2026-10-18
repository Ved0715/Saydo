/** Every string the default UI shows. Pass `messages` to <SaydoProvider> to translate or rephrase. */
export interface SaydoMessages {
  launcher: string;
  launcherLabel: string;
  placeholder: string;
  inputLabel: string;
  disclosure: string;
  hint: string;
  pages: string;
  footer: string;
  newChat: string;
  inspectorShow: string;
  inspectorHide: string;
  reloadNotice: string;
  reloadButton: string;
  confirmKicker: string;
  confirmKickerDanger: string;
  confirm: string;
  cancel: string;
  fineprint: string;
  typeToConfirm: (text: string) => string;
  confirmWithPasskey: string;
  passkeyMissing: string;
  approveAll: string;
  undo: string;
  dismiss: string;
  offline: string;
  guardBlocked: string;
}

export const defaultMessages: SaydoMessages = {
  launcher: 'Ask AI',
  launcherLabel: 'Open the AI assistant (Ctrl or Command + K)',
  placeholder: 'Ask, or jump to a page…',
  inputLabel: 'Ask the AI assistant or search pages',
  disclosure: 'AI assistant · it can make mistakes, and anything important asks you first.',
  hint: 'Ask for anything you can see or do in this app: “take me to billing”, “fill the title with Q4 plan”, “what’s my unpaid total?”',
  pages: 'Pages',
  footer: '↵ ask · ↑↓ pages · esc close',
  newChat: 'New chat',
  inspectorShow: 'What the AI sees',
  inspectorHide: 'Hide inspector',
  reloadNotice: 'The app was updated.',
  reloadButton: 'Reload',
  confirmKicker: 'Confirm action',
  confirmKickerDanger: 'Confirm destructive action',
  confirm: 'Confirm',
  cancel: 'Cancel',
  fineprint: 'Built from the exact arguments that will run. The assistant cannot approve this for you.',
  typeToConfirm: (text) => (/^\d+$/.test(text) ? `This affects ${text} items. Type ${text} to confirm.` : `Type “${text}” to confirm.`),
  confirmWithPasskey: 'Confirm with passkey',
  passkeyMissing: 'This needs a passkey. Set one up in your account to approve actions like this.',
  approveAll: 'Approve all',
  undo: 'Undo',
  dismiss: 'Dismiss',
  offline: 'The assistant is unavailable right now. You can still jump to any page from the list.',
  guardBlocked: 'This page has unsaved changes. Save or discard them first.',
};
