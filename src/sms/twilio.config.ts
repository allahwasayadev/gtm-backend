export interface TwilioSmsConfig {
  accountSid: string;
  authToken: string;
  fromPhoneNumber?: string;
  messagingServiceSid?: string;
  /** Always api.twilio.com in production. Overridable only outside production,
   *  so local tests can point at a mock without shipping that capability. */
  apiBaseUrl: string;
}

const TWILIO_API_BASE_URL = 'https://api.twilio.com';

export function getTwilioSmsConfig(): TwilioSmsConfig {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    fromPhoneNumber: process.env.TWILIO_PHONE_NUMBER || undefined,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
    apiBaseUrl:
      process.env.NODE_ENV !== 'production' && process.env.TWILIO_API_BASE_URL
        ? process.env.TWILIO_API_BASE_URL
        : TWILIO_API_BASE_URL,
  };
}
