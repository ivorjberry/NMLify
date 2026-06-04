/**
 * Fuzzy match Spotify playlist tracks against a Traktor collection.
 * Mirrors CrateHacker/collection_search.py — token-indexed pre-filter,
 * fuzz.ratio() (via fuzzball) + substring containment on both title and
 * artist, combined score = floor((title + artist) / 2).
 */
import { ratio as fuzzRatio } from 'fuzzball';

import type { NmlEntry } from './nml';
import { tokenize } from './tokenize';

export type TokenIndex = Map<string, Set<number>>;

export interface SpotifyArtist {
  name: string;
}

export interface SpotifyTrack {
  name: string;
  artists: SpotifyArtist[];
}

export interface PlaylistItem {
  track: SpotifyTrack;
}

export interface Playlist {
  items: PlaylistItem[];
}

export interface CollectionMatch {
  entry: NmlEntry;
  score: number;
}

export interface GroupedResult {
  spotify_track: SpotifyTrack;
  spotify_artists: string;
  collection_matches: CollectionMatch[];
}

export type ProgressCallback = (done: number, total: number) => void;

export interface FuzzySearchOptions {
  titleIndex?: TokenIndex;
  artistIndex?: TokenIndex;
  progressCallback?: ProgressCallback;
}

export interface FuzzySearchResult {
  groupedResults: Map<string, GroupedResult>;
  notFoundTracks: string[];
}

function addToIndex(map: TokenIndex, key: string, value: number): void {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = new Set();
    map.set(key, bucket);
  }
  bucket.add(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Build inverted indexes mapping tokens → sets of collection-entry indices,
 * one for `@TITLE` and one for `@ARTIST`.
 */
export function buildCollectionIndex(collection: NmlEntry[]): {
  titleIndex: TokenIndex;
  artistIndex: TokenIndex;
} {
  const titleIndex: TokenIndex = new Map();
  const artistIndex: TokenIndex = new Map();

  collection.forEach((entry, i) => {
    for (const tok of tokenize(readString(entry['@TITLE']))) {
      addToIndex(titleIndex, tok, i);
    }
    for (const tok of tokenize(readString(entry['@ARTIST']))) {
      addToIndex(artistIndex, tok, i);
    }
  });

  return { titleIndex, artistIndex };
}

function getCandidates(text: string, index: TokenIndex, collectionSize: number): Set<number> {
  const tokens = tokenize(text);
  const result = new Set<number>();
  if (tokens.size === 0) {
    // No usable tokens — fall back to full scan.
    for (let i = 0; i < collectionSize; i += 1) result.add(i);
    return result;
  }
  for (const tok of tokens) {
    const hits = index.get(tok);
    if (hits) {
      for (const idx of hits) result.add(idx);
    }
  }
  return result;
}

/**
 * Run fuzzy matching for every track in `playlist` against `collection`.
 *
 * When `titleIndex` + `artistIndex` are supplied, only entries that share at
 * least one token with the track's title OR artist are scored — this is the
 * O(n·k) fast path. Without the indexes the function falls back to an O(n·m)
 * full scan, useful for tiny collections and tests.
 *
 * `progressCallback(done, total)` is invoked once per processed track. Errors
 * thrown from the callback are swallowed so a flaky UI listener can't abort
 * the search.
 */
export function fuzzySearch(
  playlist: Playlist,
  collection: NmlEntry[],
  fuzzyRatio: number,
  options: FuzzySearchOptions = {},
): FuzzySearchResult {
  const { titleIndex, artistIndex, progressCallback } = options;
  const useIndex = titleIndex !== undefined && artistIndex !== undefined;
  const collectionSize = collection.length;

  const groupedResults = new Map<string, GroupedResult>();
  const notFoundTracks: string[] = [];

  const totalTracks = playlist.items.length;

  playlist.items.forEach((item, i) => {
    const spotifyTrack = item.track;
    const artists = spotifyTrack.artists.map((a) => a.name).join(', ');
    const spotifyKey = `${spotifyTrack.name}||${artists}`;
    const trackTitle = spotifyTrack.name.toLowerCase();
    const trackArtists = artists.toLowerCase();

    let candidateIndices: Iterable<number>;
    if (useIndex) {
      const titleCands = getCandidates(trackTitle, titleIndex, collectionSize);
      const artistCands = getCandidates(trackArtists, artistIndex, collectionSize);
      const merged = new Set<number>(titleCands);
      for (const idx of artistCands) merged.add(idx);
      candidateIndices = merged;
    } else {
      const all: number[] = [];
      for (let k = 0; k < collectionSize; k += 1) all.push(k);
      candidateIndices = all;
    }

    const trackMatches: CollectionMatch[] = [];
    for (const idx of candidateIndices) {
      const entry = collection[idx];
      if (!entry) continue;
      const entryTitle = readString(entry['@TITLE']).toLowerCase();
      const titleScore = fuzzRatio(trackTitle, entryTitle);
      if (
        titleScore > fuzzyRatio ||
        entryTitle.includes(trackTitle) ||
        trackTitle.includes(entryTitle)
      ) {
        // Mirror the Python branch: when @ARTIST is missing the comparison
        // string is the literal "Unknown" (capital U, not lowercased).
        const rawArtist = entry['@ARTIST'];
        const entryArtists = typeof rawArtist === 'string' ? rawArtist.toLowerCase() : 'Unknown';
        const artistScore = fuzzRatio(trackArtists, entryArtists);
        if (
          artistScore > fuzzyRatio ||
          entryArtists.includes(trackArtists) ||
          trackArtists.includes(entryArtists)
        ) {
          trackMatches.push({ entry, score: Math.floor((titleScore + artistScore) / 2) });
        }
      }
    }

    if (trackMatches.length > 0) {
      trackMatches.sort((a, b) => b.score - a.score);
      groupedResults.set(spotifyKey, {
        spotify_track: spotifyTrack,
        spotify_artists: artists,
        collection_matches: trackMatches,
      });
    } else {
      // Clean "Artist - Title" so downstream disk search can parse it without
      // having to strip a "Track not found: " prefix.
      notFoundTracks.push(`${artists} - ${spotifyTrack.name}`);
    }

    if (progressCallback) {
      try {
        progressCallback(i + 1, totalTracks);
      } catch {
        // Never let a UI listener take down the search.
      }
    }
  });

  return { groupedResults, notFoundTracks };
}
