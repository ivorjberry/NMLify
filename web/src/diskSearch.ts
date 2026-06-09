/**
 * Disk search — port of desktop/disk_search.py for the browser.
 *
 * Browsers can't see arbitrary filesystem paths. We use the
 * `<input type="file" webkitdirectory>` API to enumerate a user-picked folder,
 * then pair it with a user-supplied absolute root prefix (e.g. `D:\Music`) so
 * the Traktor LOCATION attributes we emit can be reconstructed accurately.
 *
 * Matches Python semantics for parseFilename, the token prefilter, and the
 * fuzz.ratio + substring-containment OR condition in fuzzyMatchFiles.
 */
import { ratio as fuzzRatio } from 'fuzzball';

import type { NmlEntry, NmlLocation } from './nml';
import { tokenize } from './tokenize';

export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  '.mp3', '.m4a', '.flac', '.wav', '.aiff', '.aif',
  '.ogg', '.wma', '.alac', '.opus',
  // Traktor STEM files use a compound extension. They're MP4 containers
  // with extra metadata, but only the .stem.mp4 variant should be indexed
  // as audio — bare .mp4 is usually a video and we don't want to surface
  // it as a candidate match.
  '.stem.mp4',
]);

export interface DiskFile {
  /** Absolute path of the disk source this file came from, e.g.
   *  "D:\\Music\\Library". Stored per-file so a single combined index can
   *  span multiple sources and still emit correct Traktor LOCATIONs. */
  rootPrefix: string;
  /** Path relative to the picked root, forward-slash separated, no leading
   *  slash. Empty string means the file is directly under the picked folder. */
  relativeDir: string;
  /** Bare filename including extension, e.g. "01 song.mp3". */
  filename: string;
  /** Cleaned display name derived from filename (no extension, no leading
   *  track number, underscores replaced, whitespace collapsed). */
  parsedName: string;
}

export interface DiskMatch {
  file: DiskFile;
  score: number;
}

export interface DiskFileIndex {
  files: DiskFile[];
  /** Token → set of indices into `files`. */
  byToken: Map<string, Set<number>>;
}

/** Just enough of the browser File interface for us. Real File objects satisfy
 *  this; tests can pass plain objects. */
export interface ScannableFile {
  name: string;
  webkitRelativePath: string;
}

const TRACK_NUM_RE = /^\d{1,3}[\s.\-]+/;

/** Strip extension, leading track numbers, collapse whitespace, replace
 *  underscores. Mirrors disk_search.parse_filename. Compound extensions
 *  like ".stem.mp4" are stripped in full so the display name doesn't end
 *  up with a leftover ".stem" tail. */
export function parseFilename(filename: string): string {
  const ext = extOf(filename);
  const stem = ext.length > 0 && filename.toLowerCase().endsWith(ext)
    ? filename.slice(0, filename.length - ext.length)
    : filename;
  return stem
    .replace(TRACK_NUM_RE, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Return the lower-case audio extension for `filename`, treating Traktor
 *  STEM files (".stem.mp4") as a single compound extension rather than
 *  splitting them as plain ".mp4". Non-audio files still get their bare
 *  trailing extension back so the AUDIO_EXTENSIONS check filters them. */
function extOf(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.stem.mp4')) return '.stem.mp4';
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot) : '';
}

/** Drop the leading "<picked-folder>/" segment that browsers prepend to every
 *  webkitRelativePath. The user's root prefix already represents that folder,
 *  so we want paths rooted *inside* it. */
function stripPickedRoot(webkitRelativePath: string): string {
  const slash = webkitRelativePath.indexOf('/');
  return slash >= 0 ? webkitRelativePath.slice(slash + 1) : '';
}

/** Filter a directory-picker file list down to audio files, recording the
 *  relative directory + filename + parsed display name for each one.
 *  The supplied `rootPrefix` is stamped onto each file so a combined
 *  multi-source index still knows where each file lives on disk. */
export function scanFileList(
  files: Iterable<ScannableFile>,
  rootPrefix: string,
): DiskFile[] {
  const out: DiskFile[] = [];
  for (const f of files) {
    if (!AUDIO_EXTENSIONS.has(extOf(f.name))) continue;

    // webkitRelativePath looks like "Library/genre/artist/song.mp3".
    // After stripping the picked-folder segment we get "genre/artist/song.mp3"
    // (or just "song.mp3" if the file is directly under the picked folder).
    const insideRoot = stripPickedRoot(f.webkitRelativePath);
    const lastSlash = insideRoot.lastIndexOf('/');
    const relativeDir = lastSlash >= 0 ? insideRoot.slice(0, lastSlash) : '';
    out.push({
      rootPrefix,
      relativeDir,
      filename: f.name,
      parsedName: parseFilename(f.name),
    });
  }
  return out;
}

/** Minimal structural type for a File System Access API directory handle.
 *  We only need async iteration + the kind/name discriminator, so this
 *  decouples us from lib.dom version drift and makes the walker trivial
 *  to unit-test with a hand-rolled fake. */
export interface WalkableDirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<WalkableDirectoryHandle | WalkableFileHandle>;
}

export interface WalkableFileHandle {
  kind: 'file';
  name: string;
}

/**
 * Recursively walk a File System Access API directory handle and collect
 * audio files. Filters by AUDIO_EXTENSIONS during the walk so we never
 * allocate DiskFile records for non-audio files — meaningful on libraries
 * with tens of thousands of mixed files.
 *
 * Output shape matches scanFileList() exactly so downstream code (the
 * index builder + matcher) doesn't care which picker the user used.
 *
 * onProgress, if provided, is called periodically with the running count
 * of files seen (audio or not), and once more at the end.
 */
export async function collectAudioFilesFromHandle(
  rootHandle: WalkableDirectoryHandle,
  rootPrefix: string,
  onProgress?: (filesSeen: number) => void,
): Promise<DiskFile[]> {
  const out: DiskFile[] = [];
  let seen = 0;

  async function walk(handle: WalkableDirectoryHandle, relativeDir: string): Promise<void> {
    for await (const entry of handle.values()) {
      if (entry.kind === 'file') {
        seen += 1;
        if (AUDIO_EXTENSIONS.has(extOf(entry.name))) {
          out.push({
            rootPrefix,
            relativeDir,
            filename: entry.name,
            parsedName: parseFilename(entry.name),
          });
        }
        if (onProgress && seen % 500 === 0) onProgress(seen);
      } else if (entry.kind === 'directory') {
        const next = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        await walk(entry, next);
      }
    }
  }

  await walk(rootHandle, '');
  if (onProgress) onProgress(seen);
  return out;
}

/** Inverted index from cleaned-filename tokens to file indices. */
export function buildFileIndex(files: DiskFile[]): DiskFileIndex {
  const byToken = new Map<string, Set<number>>();
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (!file) continue;
    for (const token of tokenize(file.parsedName)) {
      let bucket = byToken.get(token);
      if (!bucket) {
        bucket = new Set<number>();
        byToken.set(token, bucket);
      }
      bucket.add(i);
    }
  }
  return { files, byToken };
}

function collectCandidates(text: string, index: DiskFileIndex): Iterable<number> {
  const tokens = tokenize(text);
  if (tokens.size === 0) {
    // No tokens means no useful prefilter — fall back to scanning everything,
    // mirroring Python's `set(range(total_files))`.
    return index.files.keys();
  }
  const out = new Set<number>();
  for (const t of tokens) {
    const bucket = index.byToken.get(t);
    if (bucket) for (const i of bucket) out.add(i);
  }
  return out;
}

/** Match the not-found list against disk files. Mirrors Python
 *  fuzzy_match_files: token prefilter, fuzz.ratio score, and an extra "OR
 *  substring containment" rule so near-misses with low ratios still surface.
 *  Returns a Map keyed by the original track string (preserves insertion
 *  order); tracks with zero matches are omitted, matching Python's behavior. */
export function fuzzyMatchFiles(
  notFoundTracks: string[],
  index: DiskFileIndex,
  fuzzyRatio: number,
  progressCallback?: (done: number, total: number) => void,
): Map<string, DiskMatch[]> {
  const results = new Map<string, DiskMatch[]>();
  const total = notFoundTracks.length;

  for (let i = 0; i < notFoundTracks.length; i += 1) {
    const trackStr = notFoundTracks[i]!;
    const trackLower = trackStr.toLowerCase();
    const matches: DiskMatch[] = [];

    for (const idx of collectCandidates(trackLower, index)) {
      const file = index.files[idx];
      if (!file) continue;
      const parsedLower = file.parsedName.toLowerCase();
      const score = fuzzRatio(trackLower, parsedLower);
      if (
        score > fuzzyRatio ||
        parsedLower.includes(trackLower) ||
        trackLower.includes(parsedLower)
      ) {
        matches.push({ file, score });
      }
    }

    if (matches.length > 0) {
      matches.sort((a, b) => b.score - a.score);
      results.set(trackStr, matches);
    }

    if (progressCallback) {
      try {
        progressCallback(i + 1, total);
      } catch {
        // Swallow callback errors — mirrors Python's safe-callback behavior.
      }
    }
  }

  return results;
}

/** Build Traktor NML LOCATION attributes from an absolute root + a relative
 *  path. Handles either back- or forward-slash input for the root, and
 *  Windows-style drive prefixes (e.g. "D:"). Mirrors
 *  disk_search.filepath_to_traktor_location. */
export function locationFromRelativePath(
  rootPrefix: string,
  relativeDir: string,
  filename: string,
): NmlLocation {
  const root = rootPrefix.replace(/\\/g, '/').replace(/\/+$/, '');
  const rel = relativeDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const fullDir = rel ? `${root}/${rel}` : root;

  // Split off the drive letter, if any. Match "D:" or "D:/...".
  let volume = '';
  let tail = fullDir;
  const driveMatch = /^([A-Za-z]:)(.*)$/.exec(fullDir);
  if (driveMatch) {
    volume = driveMatch[1]!;
    tail = driveMatch[2] ?? '';
  }

  const parts = tail.split('/').filter((p) => p.length > 0);
  const traktorDir = parts.length > 0 ? `/:${parts.join('/:')}/:` : '/:';

  return {
    '@VOLUME': volume,
    '@DIR': traktorDir,
    '@FILE': filename,
  };
}

/** Build a minimal NmlEntry from a disk file + the "Artist - Title" track
 *  string from the not-found list. Splits on the first " - " just like
 *  disk_search.disk_match_to_entry. The root prefix is read directly off
 *  the file so combined indexes spanning multiple sources just work. */
export function diskMatchToEntry(
  file: DiskFile,
  trackName: string,
): NmlEntry {
  let artist = '';
  let title = trackName;
  const sep = trackName.indexOf(' - ');
  if (sep > 0) {
    artist = trackName.slice(0, sep).trim();
    title = trackName.slice(sep + 3).trim();
  }
  return {
    '@TITLE': title,
    '@ARTIST': artist,
    LOCATION: locationFromRelativePath(file.rootPrefix, file.relativeDir, file.filename),
  };
}
