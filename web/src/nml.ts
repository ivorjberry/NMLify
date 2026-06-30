/**
 * Traktor .nml (XML) load + build.
 * Mirrors the load_collection / write_nml_playlist behavior from
 * desktop/collection_utils.py so the JS layer produces files that
 * Traktor accepts the same way xmltodict's output does.
 */
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

export interface NmlLocation {
  '@DIR': string;
  '@FILE': string;
  '@VOLUME': string;
  [key: string]: unknown;
}

export interface NmlEntry {
  '@TITLE'?: string;
  '@ARTIST'?: string;
  LOCATION: NmlLocation;
  STEMS?: unknown;
  INFO?: Record<string, unknown>;
  [key: string]: unknown;
}

const XML_DECLARATION = '<?xml version="1.0" encoding="utf-8"?>\n';

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // ENTRY and NODE may appear once or many times — always treat as arrays
  // so callers can iterate without checking the shape.
  isArray: (name: string) => name === 'ENTRY' || name === 'NODE',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
});

const BUILDER = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: false,
});

/**
 * Parse a Traktor collection.nml XML string and return the list of <ENTRY>
 * dicts. Always returns a list (single ENTRY and missing COLLECTION both
 * normalize to a usable shape).
 */
export function loadCollection(xml: string): NmlEntry[] {
  const parsed = PARSER.parse(xml) as Record<string, unknown> | undefined;
  const nml = parsed?.NML as Record<string, unknown> | undefined;
  const collection = nml?.COLLECTION as Record<string, unknown> | undefined;
  const entries = collection?.ENTRY;
  if (entries == null) return [];
  if (Array.isArray(entries)) return entries as NmlEntry[];
  return [entries as NmlEntry];
}

/**
 * Read the Traktor play count for an entry, stored as the PLAYCOUNT attribute
 * on its child <INFO> node. Returns null when the track has never been played
 * (Traktor omits the attribute) or the value isn't a parseable number.
 */
export function getPlayCount(entry: NmlEntry): number | null {
  const info = entry.INFO;
  if (!info) return null;
  const raw = info['@PLAYCOUNT'];
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Strip characters Windows / NTFS won't allow in filenames. Falls back to
 * "playlist" when the input collapses to an empty string.
 */
export function sanitizePlaylistFilename(name: string): string {
  // eslint-disable-next-line no-useless-escape
  const cleaned = name.replace(/[\\/*?:"<>|]/g, '').trim();
  return cleaned || 'playlist';
}

/**
 * Build the full NML XML (HEAD + COLLECTION + SETS + PLAYLISTS) for a
 * playlist, returning the XML string. Pure — safe to call in the browser.
 */
export function buildNmlPlaylist(playlistName: string, tracks: NmlEntry[]): string {
  const keyEntries: { PRIMARYKEY: { '@TYPE': 'TRACK' | 'STEM'; '@KEY': string } }[] = [];
  for (const trackEntry of tracks) {
    const loc = trackEntry.LOCATION;
    if (!loc || loc['@VOLUME'] == null || loc['@DIR'] == null || loc['@FILE'] == null) {
      // Mirror the Python writer which logs + skips malformed entries.
      continue;
    }
    const keyPath = `${loc['@VOLUME']}${loc['@DIR']}${loc['@FILE']}`;
    const keyType: 'TRACK' | 'STEM' = 'STEMS' in trackEntry ? 'STEM' : 'TRACK';
    keyEntries.push({ PRIMARYKEY: { '@TYPE': keyType, '@KEY': keyPath } });
  }

  const doc = {
    NML: {
      '@VERSION': '20',
      HEAD: {
        '@COMPANY': 'www.native-instruments.com',
        '@PROGRAM': 'Traktor Pro 4',
      },
      COLLECTION: {
        '@ENTRIES': String(tracks.length),
        ENTRY: tracks,
      },
      SETS: { '@ENTRIES': '0' },
      PLAYLISTS: {
        NODE: {
          '@TYPE': 'PLAYLIST',
          '@NAME': playlistName,
          PLAYLIST: {
            '@ENTRIES': String(keyEntries.length),
            '@TYPE': 'LIST',
            ENTRY: keyEntries,
          },
        },
      },
    },
  };

  return XML_DECLARATION + (BUILDER.build(doc) as string);
}
