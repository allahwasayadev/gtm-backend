export function normalizeAccountName(name: string): string {
  if (!name) return '';

  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and') // Normalize & to and before stripping special chars
    .replace(/[^\w\s]/g, '') // Remove remaining special characters
    .replace(
      /\b(inc|incorporated|llc|ltd|limited|corp|corporation|company|co|the|group|holdings|enterprises|partners|associates|services|solutions|technologies|international|global)\b/g,
      '',
    ) // Remove common business suffixes and prefixes
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}
