import type { StepUpChallenge } from '../core/index';

export const toB64 = (buffer: ArrayBuffer | ArrayBufferView | null | undefined) => {
  if (!buffer) return null;
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const fromB64 = (text: string) => {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

export const passkeysSupported = () => typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';

/** Answer a WebAuthn step-up challenge with the user's passkey (Face ID, Touch ID, security key). */
export async function webauthnProof(challenge: StepUpChallenge): Promise<unknown> {
  if (!passkeysSupported()) throw new Error('Passkeys are not supported in this browser.');
  const allow = (challenge.allowCredentials as Array<{ id: string; transports?: string[] }> | undefined) ?? [];
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: fromB64(challenge.challenge),
      rpId: challenge.rpId as string,
      timeout: challenge.timeout as number,
      userVerification: 'required',
      allowCredentials: allow.map((c) => ({ type: 'public-key' as const, id: fromB64(c.id), transports: c.transports as AuthenticatorTransport[] | undefined })),
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('No passkey was used.');
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: toB64(credential.rawId),
    response: {
      clientDataJSON: toB64(response.clientDataJSON),
      authenticatorData: toB64(response.authenticatorData),
      signature: toB64(response.signature),
      userHandle: toB64(response.userHandle),
    },
  };
}

/** Let the signed-in user add a passkey (server must allow it via webauthn({ allowRegistration })). */
