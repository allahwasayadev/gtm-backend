/**
 * Placeholder detection for Twilio credentials.
 *
 * Production SSM has shipped the literal string "none" for every Twilio
 * parameter. That is worse than an empty value: the signature guard treated it
 * as a real HMAC key, so anyone who guessed the placeholder could forge a
 * signed inbound webhook and revoke a user's consent. Empty and placeholder
 * values must both be rejected.
 */
const PLACEHOLDERS = new Set([
  'none',
  'null',
  'nil',
  'undefined',
  'placeholder',
  'changeme',
  'change-me',
  'todo',
  'tbd',
  'xxx',
  'x',
  '-',
  'unset',
  'notset',
  'not-set',
  'replace',
  'replaceme',
  'dummy',
  'example',
  'test',
  'default',
]);

/** Shortest plausible Twilio secret; real auth tokens are 32 hex characters. */
const MIN_SECRET_LENGTH = 16;

/** True when a value is absent or an obvious stand-in rather than a credential. */
export function isPlaceholderValue(value: string | undefined | null): boolean {
  const v = (value ?? '').trim();
  if (!v) return true;
  if (PLACEHOLDERS.has(v.toLowerCase())) return true;
  // A single repeated character, e.g. "00000000" or "--------".
  if (/^(.)\1*$/.test(v)) return true;
  return false;
}

/**
 * True when a value is usable as a shared secret: present, not a placeholder,
 * and long enough that it cannot be guessed.
 */
export function isUsableSecret(value: string | undefined | null): boolean {
  const v = (value ?? '').trim();
  return !isPlaceholderValue(v) && v.length >= MIN_SECRET_LENGTH;
}

/** True when an identifier is present and not an obvious stand-in. */
export function isUsableIdentifier(value: string | undefined | null): boolean {
  return !isPlaceholderValue(value);
}
