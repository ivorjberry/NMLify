import type { NmlEntry } from './nml';

const TRACK_ID_BYTES = 256;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
const INITIAL_STATE = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476] as const;
const ROUND_SHIFTS = [
  ...[7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22],
  ...[5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20],
  ...[4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23],
  ...[6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21],
] as const;
const ROUND_CONSTANTS = Array.from(
  { length: 64 },
  (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0,
);
const GENERATED_STEM_PATH_RE = /(?:^|\/)(\d{3})\/([a-z0-5]{28}\.stem\.mp4)$/i;

export interface StemDirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<StemDirectoryHandle | StemFileHandle>;
}

export interface StemFileHandle {
  kind: 'file';
  name: string;
  getFile?(): Promise<File>;
}

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function decodeAudioId(audioId: string): Uint8Array {
  const normalized = audioId.replace(/\s+/g, '');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  let decoded: string;
  try {
    decoded = atob(padded);
  } catch {
    throw new Error('AUDIO_ID is not valid base64');
  }
  if (decoded.length !== TRACK_ID_BYTES) {
    throw new Error(`AUDIO_ID must decode to ${TRACK_ID_BYTES} bytes`);
  }
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

/**
 * Reproduce the Traktor byte-array digest used for generated stem sidecars.
 * Its rounds match MD5, but Traktor appends an all-zero block instead of
 * standard MD5 padding and a length footer.
 * Algorithm reference: https://github.com/zicez/traktor-stem-bridge
 */
function digestTrackId(trackId: Uint8Array): number[] {
  const state: [number, number, number, number] = [...INITIAL_STATE];
  const block = new Uint8Array(64);

  for (let offset = 0; offset <= trackId.length; offset += 64) {
    block.fill(0);
    block.set(trackId.subarray(offset, Math.min(offset + 64, trackId.length)));
    const words = new Uint32Array(16);
    const view = new DataView(block.buffer);
    for (let i = 0; i < words.length; i += 1) {
      words[i] = view.getUint32(i * 4, true);
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    const original: [number, number, number, number] = [a, b, c, d];
    for (let i = 0; i < 64; i += 1) {
      let fn: number;
      let wordIndex: number;
      if (i < 16) {
        fn = (b & c) | (~b & d);
        wordIndex = i;
      } else if (i < 32) {
        fn = (d & b) | (~d & c);
        wordIndex = (5 * i + 1) % 16;
      } else if (i < 48) {
        fn = b ^ c ^ d;
        wordIndex = (3 * i + 5) % 16;
      } else {
        fn = c ^ (b | ~d);
        wordIndex = (7 * i) % 16;
      }

      const sum = (a + fn + ROUND_CONSTANTS[i]! + words[wordIndex]!) >>> 0;
      const next = (b + rotateLeft(sum, ROUND_SHIFTS[i]!)) >>> 0;
      a = d;
      d = c;
      c = b;
      b = next;
    }

    state[0] = (original[0]! + a) >>> 0;
    state[1] = (original[1]! + b) >>> 0;
    state[2] = (original[2]! + c) >>> 0;
    state[3] = (original[3]! + d) >>> 0;
  }

  return state;
}

/** Derive Traktor's generated-stem path relative to its configured Stems root. */
export function predictGeneratedStemPath(audioId: string): string {
  const words = digestTrackId(decodeAudioId(audioId));
  const basename = words
    .flatMap((word) =>
      [0, 5, 10, 15, 20, 25, 30].map((shift) => ALPHABET[(word >>> shift) & 0x1f]!),
    )
    .join('');
  return `${String(words[0]! & 0x7f).padStart(3, '0')}/${basename}.stem.mp4`;
}

/** Return the expected generated-stem path for an entry, if its AUDIO_ID is usable. */
export function generatedStemPathForEntry(entry: NmlEntry): string | null {
  const audioId = entry['@AUDIO_ID'];
  if (typeof audioId !== 'string' || audioId.length === 0) return null;
  try {
    return predictGeneratedStemPath(audioId);
  } catch {
    return null;
  }
}

/** Normalize only paths matching Traktor's generated-sidecar layout. */
export function normalizeGeneratedStemPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const match = GENERATED_STEM_PATH_RE.exec(normalized);
  return match ? `${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}` : null;
}

export function hasGeneratedStem(entry: NmlEntry, availablePaths: ReadonlySet<string>): boolean {
  const predicted = generatedStemPathForEntry(entry);
  return predicted !== null && availablePaths.has(predicted.toLowerCase());
}

/** Index generated sidecars by relative path without opening or reading files. */
export async function indexGeneratedStemHandles(
  root: StemDirectoryHandle,
  onProgress?: (filesSeen: number) => void,
): Promise<Map<string, StemFileHandle>> {
  const files = new Map<string, StemFileHandle>();
  let seen = 0;

  async function walk(directory: StemDirectoryHandle, relativeDir: string): Promise<void> {
    for await (const entry of directory.values()) {
      if (entry.kind === 'directory') {
        const childDir = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        await walk(entry, childDir);
        continue;
      }
      seen += 1;
      const path = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const normalized = normalizeGeneratedStemPath(path);
      if (normalized) files.set(normalized, entry);
      if (onProgress && seen % 250 === 0) onProgress(seen);
    }
  }

  await walk(root, '');
  onProgress?.(seen);
  return files;
}

/** Collect generated-sidecar paths without opening or reading any files. */
export async function scanGeneratedStemHandle(
  root: StemDirectoryHandle,
  onProgress?: (filesSeen: number) => void,
): Promise<Set<string>> {
  return new Set((await indexGeneratedStemHandles(root, onProgress)).keys());
}

/** Collect generated-sidecar paths from a legacy webkitdirectory selection. */
export function scanGeneratedStemFileList(
  files: Iterable<Pick<File, 'name' | 'webkitRelativePath'>>,
): Set<string> {
  const paths = new Set<string>();
  for (const file of files) {
    const normalized = normalizeGeneratedStemPath(file.webkitRelativePath || file.name);
    if (normalized) paths.add(normalized);
  }
  return paths;
}
