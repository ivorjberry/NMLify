import { hasGeneratedStem } from './generatedStems';
import { isStemEntry, type NmlEntry } from './nml';

export const STEM_COMMENT_MARKER = 'NMLIFY_STEM';

function entryKey(entry: NmlEntry): string {
  const location = entry.LOCATION;
  return `${location?.['@VOLUME'] ?? ''}${location?.['@DIR'] ?? ''}${location?.['@FILE'] ?? ''}`
    .toLowerCase();
}

function withStemMarker(entry: NmlEntry): NmlEntry {
  const info = entry.INFO ?? {};
  const existing = typeof info['@COMMENT2'] === 'string' ? info['@COMMENT2'].trim() : '';
  const hasMarker = existing
    .split(/\s+/)
    .some((token) => token.toUpperCase() === STEM_COMMENT_MARKER);
  if (hasMarker) return entry;

  return {
    ...entry,
    INFO: {
      ...info,
      '@COMMENT2': existing ? `${existing} ${STEM_COMMENT_MARKER}` : STEM_COMMENT_MARKER,
    },
  };
}

/** Build a de-duplicated playlist of packaged and verified generated stems. */
export function buildAllStemEntries(
  collection: readonly NmlEntry[],
  generatedStemPaths: ReadonlySet<string>,
  addCommentMarker: boolean,
): NmlEntry[] {
  const entries: NmlEntry[] = [];
  const seen = new Set<string>();

  for (const entry of collection) {
    if (!isStemEntry(entry) && !hasGeneratedStem(entry, generatedStemPaths)) continue;
    const key = entryKey(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    entries.push(addCommentMarker ? withStemMarker(entry) : entry);
  }

  return entries;
}
