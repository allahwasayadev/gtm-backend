/**
 * Single source of truth for the SMS consent wording shown to users.
 *
 * The frontend renders SMS_CONSENT_TEXT verbatim and the backend stores it
 * against the consent event, so the record always reproduces exactly what the
 * user saw. Change the wording and you MUST bump SMS_CONSENT_VERSION — older
 * consent records keep pointing at the wording that was live when they signed.
 *
 * Mirrored in the frontend at src/lib/sms-consent.ts. Keep both in sync.
 *
 * "Standard message and data rates may apply" is required VERBATIM by Twilio's
 * Verify consent policy for US/Canada traffic. "Standard" may only be dropped
 * when sending to the US alone; Ovrlap's country selector offers 54 codes, so
 * it stays. The string also contains the "message and data rates may apply"
 * phrase TCR looks for during A2P campaign review.
 *
 * v3 narrowed the declared use case. v2 claimed "account verification, login,
 * and account security", but the app sends SMS for exactly one thing: a
 * one-time verification code, from signup and from profile settings. Nothing
 * fires on login. A campaign use case must match real traffic, so the wording
 * now describes only what is actually sent.
 */
export const SMS_CONSENT_VERSION = '2026-09-27.v3';

export const SMS_CONSENT_TEXT =
  'I agree to receive automated SMS messages from Ovrlap containing ' +
  'one-time account verification codes. Consent is not a condition of ' +
  'purchase or of creating an account. Message frequency varies — you ' +
  'receive a message only when you request a verification code. Standard ' +
  'message and data rates may apply. Reply STOP to opt out and HELP for help.';

/** Where a consent event was captured. Stored on SmsConsentEvent.source. */
export const SmsConsentSource = {
  SignupForm: 'signup_form',
  VerifyPhoneScreen: 'verify_phone_screen',
  ProfileSettings: 'profile_settings',
  SmsKeyword: 'sms_keyword',
} as const;

export type SmsConsentSourceValue =
  (typeof SmsConsentSource)[keyof typeof SmsConsentSource];

/** The only use case Ovrlap sends under. There is no marketing traffic. */
export const SMS_USE_CASE = 'account_verification';
