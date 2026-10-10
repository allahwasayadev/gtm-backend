function normalizeOrigin(origin: string): string {
  return origin.endsWith('/') ? origin.slice(0, -1) : origin;
}

function getFrontendOrigins(frontendUrl?: string): string[] {
  if (!frontendUrl) {
    return [];
  }

  const origins = new Set<string>([normalizeOrigin(frontendUrl)]);

  try {
    const url = new URL(frontendUrl);

    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
    } else {
      url.hostname = `www.${url.hostname}`;
    }

    origins.add(normalizeOrigin(url.toString()));
  } catch {
    return Array.from(origins);
  }

  return Array.from(origins);
}

/**
 * Additional allowed origins, comma-separated.
 *
 * Deliberately separate from FRONTEND_URL, which must keep pointing at the
 * canonical site because it also builds every link in outbound email. This is
 * for temporary or secondary origins — a staging Amplify preview, for example.
 */
function getExtraOrigins(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((o) => normalizeOrigin(o.trim()))
    .filter(Boolean);
}

export const corsOrigins = [
  ...getFrontendOrigins(process.env.FRONTEND_URL),
  ...getExtraOrigins(process.env.EXTRA_CORS_ORIGINS),
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];
