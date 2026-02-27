export interface TwilioSmsConfig {
  accountSid: string;
  authToken: string;
  fromPhoneNumber?: string;
  messagingServiceSid?: string;
}

export function getTwilioSmsConfig(): TwilioSmsConfig {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    fromPhoneNumber: process.env.TWILIO_PHONE_NUMBER || undefined,
    messagingServiceSid:
      process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
  };
}
