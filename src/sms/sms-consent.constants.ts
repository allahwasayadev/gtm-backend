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
 * v3 narrowed the declared use case to verification codes only.
 *
 * v4 reflects the SMS-first signup flow: a phone number is REQUIRED at signup,
 * the activation code is sent only by SMS, and password reset codes also go to
 * the verified phone. The v3 sentence "Consent is not a condition of purchase
 * or of creating an account" is therefore no longer true and has been removed
 * rather than left to mislead.
 *
 * !! This makes SMS consent a condition of creating an account, which the
 * CURRENTLY APPROVED campaign explicitly says it is not, and which is the
 * substance of Twilio error 30923. The campaign description must be updated
 * and accepted before this wording reaches production. Consent records written
 * under v3 keep pointing at the v3 text, which is why the version is bumped
 * rather than edited in place.
 *
 * STOP/HELP stays in THIS wording even though it was removed from the outgoing
 * message body: opt-out instructions are required at the point of opt-in.
 */
export const SMS_CONSENT_VERSION = '2026-10-04.v4';

export const SMS_CONSENT_TEXT =
  'I agree to receive automated SMS messages from Ovrlap containing one-time ' +
  'account verification and password reset codes. A verification code sent to ' +
  'this number is required to activate your account, so SMS is needed to ' +
  'finish signing up and to reset your password. Message frequency varies — ' +
  'you receive a message only when you request a code. Standard message and ' +
  'data rates may apply. Reply STOP to opt out and HELP for help.';

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
