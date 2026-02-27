const ARTICLE_TOKENS = new Set(['a', 'an', 'the']);

// Corporate suffixes should only be stripped from the tail of the name.
const CORPORATE_SUFFIX_TOKENS = new Set([
  'inc',
  'incorporated',
  'llc',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'company',
  'co',
  'group',
  'holding',
  'holdings',
  'plc',
  'lp',
  'llp',
  'gmbh',
  'ag',
  'sa',
  'bv',
]);

export function normalizeAccountName(name: string): string {
  if (!name) return '';

  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[_/\\]+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ');

  const rawTokens = normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (!rawTokens.length) {
    return '';
  }

  const withoutArticles = rawTokens.filter(
    (token) => !ARTICLE_TOKENS.has(token),
  );
  if (!withoutArticles.length) {
    return '';
  }

  while (
    withoutArticles.length > 0 &&
    CORPORATE_SUFFIX_TOKENS.has(withoutArticles[withoutArticles.length - 1])
  ) {
    withoutArticles.pop();
  }

  // Handles patterns like "& Co" -> "and co" where removing the suffix leaves a dangling connector.
  while (
    withoutArticles.length > 0 &&
    withoutArticles[withoutArticles.length - 1] === 'and'
  ) {
    withoutArticles.pop();
  }

  return withoutArticles.join(' ').trim();
}
