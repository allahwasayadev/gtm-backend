import { Logger } from '@nestjs/common';

const logger = new Logger('SmsTestMode');

/**
 * Isolated-environment test mode, for demonstrating the verification flow to a
 * reviewer before live SMS is available.
 *
 * What it does: for an allow-listed number, the OTP is the configured test code
 * instead of a random one, and no message is handed to Twilio. Everything else
 * is unchanged — the code is still hashed, still stored, still expires, still
 * rate-limited, and is still checked on submission. A wrong code is still
 * rejected. It does NOT accept arbitrary codes and it does NOT mark a number
 * verified without a valid check.
 *
 * It cannot run in production: enabled() throws at startup if NODE_ENV is
 * production, and the allow-list must be set explicitly.
 */
export interface SmsTestModeConfig {
  enabled: boolean;
  code: string;
  allowedNumbers: string[];
}

let warned = false;

export function getSmsTestModeConfig(): SmsTestModeConfig {
  const flag = process.env.SMS_TEST_MODE === 'true';

  if (!flag) {
    return { enabled: false, code: '', allowedNumbers: [] };
  }

  if (process.env.NODE_ENV === 'production') {
    // Refuse to start rather than silently degrade real verification.
    throw new Error(
      'SMS_TEST_MODE must never be enabled when NODE_ENV=production. ' +
        'Unset SMS_TEST_MODE on this environment.',
    );
  }

  const code = (process.env.SMS_TEST_CODE ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    throw new Error(
      'SMS_TEST_MODE=true requires SMS_TEST_CODE to be a 6-digit code.',
    );
  }

  const allowedNumbers = (process.env.SMS_TEST_PHONE_ALLOWLIST ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);

  if (allowedNumbers.length === 0) {
    throw new Error(
      'SMS_TEST_MODE=true requires SMS_TEST_PHONE_ALLOWLIST to list at least ' +
        'one E.164 number. Test mode never applies to unlisted numbers.',
    );
  }

  if (!warned) {
    warned = true;
    logger.warn(
      `SMS TEST MODE ACTIVE (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}). ` +
        `No SMS will be sent to ${allowedNumbers.length} allow-listed number(s); ` +
        'the fixed test code is still hashed, stored and verified normally. ' +
        'All other numbers use the live Twilio path.',
    );
  }

  return { enabled: true, code, allowedNumbers };
}

/** True only for an allow-listed number while test mode is on. */
export function isTestNumber(phoneNumber: string): boolean {
  const cfg = getSmsTestModeConfig();
  return cfg.enabled && cfg.allowedNumbers.includes(phoneNumber);
}

/** The fixed code for an allow-listed number, or null to generate a real one. */
export function testCodeFor(phoneNumber: string): string | null {
  const cfg = getSmsTestModeConfig();
  if (!cfg.enabled || !cfg.allowedNumbers.includes(phoneNumber)) return null;
  return cfg.code;
}
