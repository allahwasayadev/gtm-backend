export function normalizeAccountName(name: string): string {
  if (!name) return '';

  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|the)\b/g, '') // Remove common suffixes
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}
