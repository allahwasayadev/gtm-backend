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

export const corsOrigins = [
  ...getFrontendOrigins(process.env.FRONTEND_URL),
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];
