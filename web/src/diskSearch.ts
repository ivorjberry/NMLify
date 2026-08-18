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
  // Traktor STEM files can ship either as a compound ".stem.mp4" or just
  // ".mp4" / ".m4a" — they're all MP4-family containers with the extra
  // STEM metadata. We index every MP4-family extension so renamed stems
  // and other DJ-ready audio MP4s come through. Bare ".mp4" video files
  // in a music folder are uncommon enough that the false-positive risk
  // is worth paying for full STEM coverage.
  '.mp4', '.stem.mp4',
]);

export interface DiskFileTags {
  artist?: string;
  title?: string;
  album?: string;
}

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
  /** Optional ID3/MP4/Vorbis tags read from the file. Populated only when
   *  the user opts in to tag-reading during the scan, since it's an order
   *  of magnitude slower than a plain filename walk. When present, the
   *  matcher prefers tag fields over the parsed filename for scoring. */
  tags?: DiskFileTags;
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
  /** Real FileSystemFileHandles expose this; tests typically don't. When
   *  present and a TagReader is supplied to collectAudioFilesFromHandle,
   *  it's used to read the file's audio metadata. */
  getFile?(): Promise<File>;
}

export interface IndexedAudioFileHandle {
  relativeDir: string;
  filename: string;
  handle: WalkableFileHandle;
}

/** Async function that parses a file's audio metadata. Injected from
 *  diskTags.ts so this module stays free of the music-metadata dependency
 *  and remains trivially unit-testable. */
export type TagReader = (file: File) => Promise<DiskFileTags | undefined>;

export interface CollectAudioFilesOptions {
  /** Async function that parses tags from a File blob (see TagReader). */
  readTags?: TagReader;
  /** Fired as tags finish parsing: (done, total audio files). */
  onTagProgress?: (done: number, total: number) => void;
  /** How many tag reads to overlap. Browser file I/O benefits a lot from
   *  parallelism on spinning disks; 4 is a safe default. */
  tagConcurrency?: number;
}

/** Recursively index audio file handles while retaining their relative paths. */
export async function indexAudioFileHandles(
  rootHandle: WalkableDirectoryHandle,
  onProgress?: (filesSeen: number) => void,
): Promise<IndexedAudioFileHandle[]> {
  const files: IndexedAudioFileHandle[] = [];
  let seen = 0;

  async function walk(handle: WalkableDirectoryHandle, relativeDir: string): Promise<void> {
    for await (const entry of handle.values()) {
      if (entry.kind === 'file') {
        seen += 1;
        if (AUDIO_EXTENSIONS.has(extOf(entry.name))) {
          files.push({ relativeDir, filename: entry.name, handle: entry });
        }
        if (onProgress && seen % 500 === 0) onProgress(seen);
      } else {
        const next = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        await walk(entry, next);
      }
    }
  }

  await walk(rootHandle, '');
  onProgress?.(seen);
  return files;
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
  options: CollectAudioFilesOptions = {},
): Promise<DiskFile[]> {
  const indexed = await indexAudioFileHandles(rootHandle, onProgress);
  const out = indexed.map(({ relativeDir, filename }) => ({
    rootPrefix,
    relativeDir,
    filename,
    parsedName: parseFilename(filename),
  }));
  const handles = indexed.map(({ handle }) => handle);

  const { readTags, onTagProgress, tagConcurrency = 4 } = options;
  if (readTags && out.length > 0) {
    await enrichWithTags(out, handles, readTags, tagConcurrency, onTagProgress);
  }

  return out;
}

/** Drive `readTags` over the (file, handle) pairs with bounded concurrency.
 *  Individual failures are swallowed — a missing or corrupt tag should
 *  never abort the scan; the file just falls back to filename matching. */
async function enrichWithTags(
  files: DiskFile[],
  handles: WalkableFileHandle[],
  readTags: TagReader,
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = files.length;
  let done = 0;
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next;
      next += 1;
      if (i >= total) return;
      const handle = handles[i];
      const file = files[i];
      if (file && handle && typeof handle.getFile === 'function') {
        try {
          const blob = await handle.getFile();
          const tags = await readTags(blob);
          if (tags) file.tags = tags;
        } catch {
          // Per-file failure is non-fatal; move on.
        }
      }
      done += 1;
      if (onProgress) {
        try {
          onProgress(done, total);
        } catch {
          // Never let a UI listener take down the scan.
        }
      }
    }
  }

  const n = Math.max(1, Math.min(concurrency, total));
  await Promise.all(Array.from({ length: n }, worker));
}

/** Inverted index from cleaned-filename tokens to file indices. When a
 *  file has tags, those tokens are also indexed so tag-only matches still
 *  survive the prefilter. */
export function buildFileIndex(files: DiskFile[]): DiskFileIndex {
  const byToken = new Map<string, Set<number>>();
  function add(token: string, i: number): void {
    let bucket = byToken.get(token);
    if (!bucket) {
      bucket = new Set<number>();
      byToken.set(token, bucket);
    }
    bucket.add(i);
  }
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (!file) continue;
    for (const token of tokenize(file.parsedName)) add(token, i);
    if (file.tags) {
      if (file.tags.title) for (const t of tokenize(file.tags.title)) add(t, i);
      if (file.tags.artist) for (const t of tokenize(file.tags.artist)) add(t, i);
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
 *  fuzzy_match_files's token prefilter and fuzz.ratio score, but drops
 *  the original "OR substring containment" branch — in practice that
 *  branch surfaced very-low-score noise (e.g. a file `one.mp3` matching
 *  "Daft Punk - One More Time…" with score ~16) and made the user-set
 *  threshold meaningless. The score threshold is now strict.
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
    // Pre-split the search string once per track. When a file has tags
    // we score artist-vs-tag-artist and title-vs-tag-title separately,
    // mirroring how the NML collection match works.
    const sepIdx = trackStr.indexOf(' - ');
    const queryArtist = sepIdx > 0 ? trackStr.slice(0, sepIdx).trim().toLowerCase() : '';
    const queryTitle = sepIdx > 0 ? trackStr.slice(sepIdx + 3).trim().toLowerCase() : trackLower;
    const matches: DiskMatch[] = [];

    for (const idx of collectCandidates(trackLower, index)) {
      const file = index.files[idx];
      if (!file) continue;

      let score: number;
      const tagTitle = file.tags?.title?.toLowerCase() ?? '';
      const tagArtist = file.tags?.artist?.toLowerCase() ?? '';
      if (tagTitle || tagArtist) {
        // Tag path: average the available axes. Missing one side collapses
        // to the other so a file with only a TITLE tag still gets a
        // meaningful score.
        const titleScore = tagTitle ? fuzzRatio(queryTitle, tagTitle) : 0;
        const artistScore = tagArtist && queryArtist ? fuzzRatio(queryArtist, tagArtist) : 0;
        if (tagTitle && tagArtist && queryArtist) {
          score = Math.floor((titleScore + artistScore) / 2);
        } else if (tagTitle) {
          score = titleScore;
        } else {
          score = artistScore;
        }
      } else {
        // No tags \u2014 fall back to the parsed-filename comparison.
        const parsedLower = file.parsedName.toLowerCase();
        score = fuzzRatio(trackLower, parsedLower);
      }

      if (score > fuzzyRatio) {
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
