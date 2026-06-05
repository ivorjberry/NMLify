/**
 * Shared text-normalization helpers used by collection and disk search.
 * Mirrors desktop/text_utils.py so the JS index lines up with the Python one.
 * Keep this module dependency-free so it stays cheap to import.
 */

/** Minimum token length to index (skip "a", "of", "the", etc.). */
export const MIN_TOKEN_LEN = 2;

/** Common words that appear in too many titles to be useful filters. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and',
  'or', 'is', 'it', 'my', 'me', 'no', 'so', 'do', 'up', 'be',
  'feat', 'ft', 'vs', 'remix', 'mix', 'edit', 'version', 'radio',
  'original', 'extended',
]);

const TOKEN_RE = /[a-z0-9]+/g;

/**
 * Split text into lowercase alphanumeric tokens, dropping stop words and very short ones.
 * Returns an empty set for null, undefined, or empty input.
 */
export function tokenize(text: string | null | undefined): Set<string> {
  if (!text) {
    return new Set();
  }
  const result = new Set<string>();
  const lower = text.toLowerCase();
  // Reset lastIndex because TOKEN_RE has the /g flag and is module-scoped.
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(lower)) !== null) {
    const token = match[0];
    if (token.length >= MIN_TOKEN_LEN && !STOP_WORDS.has(token)) {
      result.add(token);
    }
  }
  return result;
}
