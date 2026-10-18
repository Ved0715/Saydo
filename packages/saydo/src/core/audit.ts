import { canonicalize } from './jcs';
import type { AuditEntry } from './engine';

export interface AuditRecord extends AuditEntry {
  seq: number;
  prevHash: string;
  hash: string;
}

const encoder = new TextEncoder();

async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Tamper-evident audit trail: each record carries the hash of the previous one,
 * so deleting or editing any entry breaks the chain. Entries contain no action
 * arguments (no PII); they record who, what, which tier, how consent was given,
 * a digest of the confirmation shown, the model and the deployed manifest.
 *
 *   audit: createAuditLog((record) => db.insert('saydo_audit', record))
 */
export function createAuditLog(write: (record: AuditRecord) => void | Promise<void>, options: { genesis?: string } = {}) {
  let seq = 0;
  let prevHash = options.genesis ?? '0'.repeat(64);
  let chain: Promise<void> = Promise.resolve();
  const log = (entry: AuditEntry) => {
    chain = chain
      .then(async () => {
        const body = { ...entry, seq: ++seq, prevHash };
        const hash = await sha256(canonicalize(body));
        prevHash = hash;
        await write({ ...body, hash });
      })
      .catch((error) => console.error('[saydo] audit write failed', error));
  };
  /** Wait for pending writes (tests, graceful shutdown). */
  log.flush = () => chain;
  return log;
}

/** Verify a chain of audit records. Returns the index of the first broken record, or -1 if intact. */
export async function verifyAuditChain(records: AuditRecord[], genesis = '0'.repeat(64)): Promise<number> {
  let prev = genesis;
  for (let i = 0; i < records.length; i++) {
    const { hash, ...body } = records[i]!;
    if (body.prevHash !== prev || (await sha256(canonicalize(body))) !== hash) return i;
    prev = hash;
  }
  return -1;
}
