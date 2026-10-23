import { Logger } from '@nestjs/common';

const logger = new Logger('OtpDomain');

/**
 * The hostname that binds an OTP message to this site, for WebOTP.
 *
 * Android Chrome fills a code only when the message's last line is
 *
 *     @<hostname> #<code>
 *
 * and that hostname matches the origin of the page that asked. See
 * https://web.dev/articles/sms-otp-form.
 *
 * CONFIGURED, NEVER DERIVED FROM A REQUEST. Not the Host header, not Origin,
 * not Referer, not anything else a caller can set: those are attacker-
 * controlled, and a number bound to a host of the attacker's choosing is a
 * code handed to their page. It comes from SMS_OTP_DOMAIN and nowhere else.
 *
 * FRONTEND_URL is deliberately not used as a fallback either. It is a
 * different setting with a different job, and on this deployment it holds the
 * apex while the site is served from www — binding to the wrong host would
 * silently stop the fill working with no error anywhere.
 *
 * Unset means the line is not appended at all and message bodies are exactly
 * what they were. That is the default, and it is what keeps an unconfigured
 * environment byte-for-byte identical to the approved campaign samples.
 */

/** A DNS hostname: labels of letters, digits and hyphens, dot-separated. */
const HOSTNAME =
  /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/**
 * An IP literal, which WebOTP will not accept.
 *
 * The spec resolves the "@host" line against the page's *effective domain*,
 * and that step is defined for domain-format hosts only — an address literal
 * is not a domain, so a message bound to one never matches and never fills.
 * https://wicg.github.io/web-otp/#sctn-discover-from-external-source
 *
 * Caught by the last label being all digits, which is also exactly why a
 * real TLD cannot be numeric. Rejecting it here turns a silent
 * never-fills into a startup error.
 */
const IPV4_LITERAL = /^\d+(\.\d+)*$/;
const IPV6_LITERAL = /^\[?[0-9a-f:]*:[0-9a-f:]*\]?$/;

function isIpLiteral(hostname: string): boolean {
  return IPV4_LITERAL.test(hostname) || IPV6_LITERAL.test(hostname);
}

let warned = false;

/**
 * The configured hostname, or null when the feature is off.
 *
 * Throws on a value that is set but unusable — a scheme, a path, a port, a
 * space. Failing at the first send is better than appending a line that looks
 * right, binds nothing, and is discovered only when a user reports that the
 * code never fills.
 */
export function getOtpDomain(): string | null {
  const raw = (process.env.SMS_OTP_DOMAIN ?? '').trim();
  if (!raw) return null;

  const hostname = raw.toLowerCase();

  if (isIpLiteral(hostname)) {
    throw new Error(
      `SMS_OTP_DOMAIN must be a domain name, not an IP address. WebOTP ` +
        `matches the message against the page's effective domain, and an ` +
        `address literal has none — the code would silently never fill. ` +
        `Use a hostname that resolves to the host instead. ` +
        `Received: ${JSON.stringify(raw)}`,
    );
  }

  if (!HOSTNAME.test(hostname)) {
    throw new Error(
      `SMS_OTP_DOMAIN must be a bare hostname such as www.ovrlap.app — no ` +
        `scheme, port or path. Received: ${JSON.stringify(raw)}`,
    );
  }

  if (!warned) {
    warned = true;
    logger.warn(
      `OTP messages will carry the WebOTP binding line "@${hostname} #<code>". ` +
        `This CHANGES the message body, so the campaign's sample messages must ` +
        `already have been updated and accepted for this hostname.`,
    );
  }

  return hostname;
}

/**
 * Append the WebOTP binding line to a message body.
 *
 * The body above it is untouched — same wording, same expiry, same STOP and
 * HELP disclosure. The line carries no URL: it is a binding token that Chrome
 * parses, not a link, and a 2FA message with a link in it is a phishing
 * lesson we do not want to teach.
 */
export function withOtpDomainBinding(body: string, code: string): string {
  const hostname = getOtpDomain();
  if (!hostname) return body;
  return `${body}\n@${hostname} #${code}`;
}

/** Test seam: forget that the warning has been logged. */
export function resetOtpDomainWarning(): void {
  warned = false;
}
