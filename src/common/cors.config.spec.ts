/**
 * FRONTEND_URL must stay canonical because it also builds outbound email
 * links, so additional allowed origins live in their own variable. These tests
 * pin that separation.
 */
describe('corsOrigins', () => {
  const OLD_ENV = process.env;

  const load = (): string[] => {
    jest.resetModules();
    return jest.requireActual<typeof import('./cors.config')>('./cors.config')
      .corsOrigins;
  };

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.EXTRA_CORS_ORIGINS;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('derives both apex and www from FRONTEND_URL', () => {
    process.env.FRONTEND_URL = 'https://www.ovrlap.app';
    const o = load();
    expect(o).toContain('https://www.ovrlap.app');
    expect(o).toContain('https://ovrlap.app');
  });

  it('adds extra origins without disturbing FRONTEND_URL', () => {
    process.env.FRONTEND_URL = 'https://www.ovrlap.app';
    process.env.EXTRA_CORS_ORIGINS =
      'https://main.d1bnv3j9cog2ro.amplifyapp.com';
    const o = load();
    expect(o).toContain('https://main.d1bnv3j9cog2ro.amplifyapp.com');
    expect(o).toContain('https://www.ovrlap.app');
  });

  it('accepts several extra origins and trims whitespace', () => {
    process.env.FRONTEND_URL = 'https://www.ovrlap.app';
    process.env.EXTRA_CORS_ORIGINS =
      ' https://a.example.com , https://b.example.com ';
    const o = load();
    expect(o).toContain('https://a.example.com');
    expect(o).toContain('https://b.example.com');
  });

  it('strips a trailing slash so it matches a browser Origin header', () => {
    process.env.FRONTEND_URL = 'https://www.ovrlap.app';
    process.env.EXTRA_CORS_ORIGINS = 'https://preview.example.com/';
    expect(load()).toContain('https://preview.example.com');
  });

  it('adds nothing when the variable is unset or empty', () => {
    process.env.FRONTEND_URL = 'https://www.ovrlap.app';
    const baseline = load();
    process.env.EXTRA_CORS_ORIGINS = '';
    expect(load()).toEqual(baseline);
  });

  it('does not allow an arbitrary origin that was never configured', () => {
    process.env.FRONTEND_URL = 'https://www.ovrlap.app';
    process.env.EXTRA_CORS_ORIGINS =
      'https://main.d1bnv3j9cog2ro.amplifyapp.com';
    expect(load()).not.toContain('https://evil.example.com');
  });
});
