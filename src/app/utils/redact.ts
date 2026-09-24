// Removes secrets and personal data before anything is written to audit or activity logs.
const SENSITIVE_KEY = /pass(word)?|pin|otp|secret|token|idnumber|cardnumber|card_number|cvc|cvv|iban|signature|mfa|authorization|cookie/i;

export const redact = (value: unknown, depth = 0): unknown => {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    if (value instanceof Date) return value;
    if (typeof (value as any).toHexString === 'function') return String(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
};

// Shallow before/after diff of the fields that changed.
export const diff = (before: Record<string, any> = {}, after: Record<string, any> = {}) => {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (['_id', '__v', 'updatedAt', 'createdAt'].includes(k)) continue;
    const a = JSON.stringify(before[k]);
    const b = JSON.stringify(after[k]);
    if (a !== b) changes[k] = { from: redact({ [k]: before[k] }) as any, to: redact({ [k]: after[k] }) as any };
  }
  for (const k of Object.keys(changes)) {
    changes[k] = { from: (changes[k]!.from as any)[k], to: (changes[k]!.to as any)[k] };
  }
  return changes;
};
