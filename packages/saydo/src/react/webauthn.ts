'use client';
import { useMemo } from 'react';
import { useRuntime } from './context';
import { fromB64, passkeysSupported, toB64, webauthnProof } from './webauthn-proof';

export { passkeysSupported, webauthnProof };

export function usePasskeys() {
  const runtime = useRuntime();
  return useMemo(
    () => ({
      supported: passkeysSupported(),
      async register(name?: string): Promise<{ ok: boolean; message?: string }> {
        const start = (await runtime.call({ type: 'passkey-options' })) as
          | { ok: true; publicKey: Record<string, any>; token: string }
          | { ok: false; message: string; fix: string };
        if (!start?.ok) return { ok: false, message: start ? `${start.message} ${start.fix}` : 'Network error.' };
        const pk = start.publicKey;
        const created = (await navigator.credentials.create({
          publicKey: {
            ...pk,
            challenge: fromB64(pk.challenge),
            user: { ...pk.user, id: fromB64(pk.user.id) },
            excludeCredentials: (pk.excludeCredentials ?? []).map((c: { id: string; type: 'public-key' }) => ({ ...c, id: fromB64(c.id) })),
          } as unknown as PublicKeyCredentialCreationOptions,
        })) as PublicKeyCredential | null;
        if (!created) return { ok: false, message: 'Passkey setup was cancelled.' };
        const response = created.response as AuthenticatorAttestationResponse;
        const result = (await runtime.call({
          type: 'passkey-register',
          token: start.token,
          name,
          credential: {
            id: toB64(created.rawId),
            response: {
              clientDataJSON: toB64(response.clientDataJSON),
              authenticatorData: toB64(response.getAuthenticatorData()),
              publicKey: toB64(response.getPublicKey()),
              publicKeyAlgorithm: response.getPublicKeyAlgorithm(),
              transports: response.getTransports?.(),
            },
          },
        })) as { ok: boolean; message?: string } | null;
        return result?.ok ? { ok: true } : { ok: false, message: result?.message ?? 'Registration failed.' };
      },
    }),
    [runtime],
  );
}
