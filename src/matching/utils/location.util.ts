/**
 * Splits a free-text location into comparable tokens: lower-cased, accents removed,
 * split on `, ; / |`. "Algiers, Algeria" → { "algiers", "algeria" }.
 */
export function locationTokens(value: string | null | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[,;/|]+/)
      .map((token) => token.trim().replace(/\s+/g, ' '))
      .filter((token) => token.length > 0),
  );
}

/** Two locations match when they share at least one token (e.g. same city). */
export function locationsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const tokensB = locationTokens(b);
  for (const token of locationTokens(a)) {
    if (tokensB.has(token)) return true;
  }
  return false;
}
