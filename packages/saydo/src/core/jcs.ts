/**
 * RFC 8785 JSON Canonicalization Scheme. Used wherever arguments cross a trust
 * boundary and must be compared byte-for-byte (for example `withGrant` matching
 * a client request body against the staged arguments). Strings are NFC
 * normalized first so visually identical input compares equal.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS: non-finite numbers are not JSON');
    // ES Number serialization is what RFC 8785 specifies.
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v ?? null)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && typeof v !== 'function')
      .map(([k, v]) => [k.normalize('NFC'), v] as const)
      // RFC 8785 sorts by UTF-16 code units, which is JS's default string order.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  throw new TypeError(`JCS: cannot canonicalize ${typeof value}`);
}

export function canonicalEqual(a: unknown, b: unknown): boolean {
  try {
    return canonicalize(a) === canonicalize(b);
  } catch {
    return false;
  }
}
