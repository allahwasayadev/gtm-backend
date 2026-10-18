/**
 * Phone number canonicalisation.
 *
 * Every number we store is canonical E.164, and US entry is now the default
 * path: the signup, activation and profile screens show a fixed +1 and collect
 * ten digits. So a bare ten-digit number — or eleven digits beginning with the
 * country code — is accepted here and canonicalised to +1XXXXXXXXXX.
 *
 * A number that already carries a '+' is honoured as given. That is what keeps
 * the non-US numbers on existing accounts working: the US default is an input
 * convenience, not a restriction on what an account may already hold.
 *
 * Canonicalising before any lookup is also what makes deduplication correct.
 * "2015550123", "(201) 555-0123" and "+12015550123" are one number, and must
 * resolve to one account rather than three.
 */

/** Dial code for the North American Numbering Plan — the only default we offer. */
export const US_COUNTRY_CODE = '+1';

/** Digits in a US national number, after the country code. */
export const US_NATIONAL_DIGITS = 10;

/** Punctuation people type inside a number. Not stripped from the leading '+'. */
const SEPARATORS = /[\s().\-‐-―]/g;

/** Generic E.164: a '+', a non-zero country code, then 7–14 more digits. */
const E164 = /^\+[1-9]\d{7,14}$/;

/** Remove the spacing and punctuation people type inside a number. */
export function stripPhoneSeparators(raw: string): string {
  return raw.trim().replace(SEPARATORS, '');
}

/**
 * The ten national digits of a US number, from whatever the user typed.
 *
 * Accepts ten digits, eleven beginning with the country code, and either of
 * those written with a +1 prefix or with punctuation. Returns null when the
 * input cannot be read as a US national number — the caller decides whether
 * that is an error or simply "not a US number".
 */
export function toUsNationalDigits(raw: string): string | null {
  const cleaned = stripPhoneSeparators(raw);
  if (!cleaned) return null;

  // A '+' commits to a country code, so only '+1' may be read as US.
  if (cleaned.startsWith('+')) {
    if (!cleaned.startsWith(US_COUNTRY_CODE)) return null;
    const digits = cleaned.slice(US_COUNTRY_CODE.length);
    return /^\d{10}$/.test(digits) ? digits : null;
  }

  if (!/^\d+$/.test(cleaned)) return null;
  if (cleaned.length === US_NATIONAL_DIGITS) return cleaned;
  if (cleaned.length === US_NATIONAL_DIGITS + 1 && cleaned.startsWith('1')) {
    return cleaned.slice(1);
  }
  return null;
}

/** "2015550123" -> "+12015550123". Null if it is not a US national number. */
export function canonicalizeUsPhoneNumber(raw: string): string | null {
  const digits = toUsNationalDigits(raw);
  return digits ? `${US_COUNTRY_CODE}${digits}` : null;
}

/**
 * Canonical E.164 for anything a user may type, or null if it is unreadable.
 *
 * Never throws. Callers that must reject bad input raise their own error, and
 * callers that must stay silent — password reset, which may not disclose
 * whether an account exists — simply get null.
 */
export function canonicalizePhoneNumber(raw: string): string | null {
  const cleaned = stripPhoneSeparators(raw);
  if (!cleaned) return null;

  if (cleaned.startsWith('+')) {
    return E164.test(cleaned) ? cleaned : null;
  }

  return canonicalizeUsPhoneNumber(cleaned);
}

/** True for a canonical US number in E.164 form. */
export function isUsE164(value: string): boolean {
  return new RegExp(`^\\${US_COUNTRY_CODE}\\d{${US_NATIONAL_DIGITS}}$`).test(
    value,
  );
}
