import {
  generatedStemPathForEntry,
  normalizeGeneratedStemPath,
  predictGeneratedStemPath,
} from './generatedStems';
import {
  locationFromRelativePath,
  type IndexedAudioFileHandle,
} from './diskSearch';
import { sanitizePlaylistFilename, type NmlEntry } from './nml';

export const STEM_SHARE_FORMAT = 'nmlify-stem-share';
export const STEM_SHARE_VERSION = 2;

export interface StemShareItem {
  audioId: string;
  artist: string;
  title: string;
  originalLocation: string;
  originalPath?: string;
  sidecarPath: string;
}

export interface StemShareManifest {
  format: typeof STEM_SHARE_FORMAT;
  version: 1 | typeof STEM_SHARE_VERSION;
  createdAt: string;
  entries: StemShareItem[];
}

export interface StemSharePlanItem extends StemShareItem {
  entry: NmlEntry;
}

export interface StemShareExportItem extends StemSharePlanItem {
  originalPath: string;
  originalFile: IndexedAudioFileHandle;
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function originalLocation(entry: NmlEntry): string {
  const location = entry.LOCATION;
  return `${readText(location?.['@VOLUME'])}${readText(location?.['@DIR'])}${readText(location?.['@FILE'])}`;
}

/** Match collection entries to available sidecars, de-duplicating shared paths. */
export function buildStemSharePlan(
  collection: NmlEntry[],
  availablePaths: ReadonlySet<string>,
): StemSharePlanItem[] {
  const plan: StemSharePlanItem[] = [];
  const includedPaths = new Set<string>();

  for (const entry of collection) {
    const audioId = entry['@AUDIO_ID'];
    const predicted = generatedStemPathForEntry(entry);
    const lookupPath = predicted?.toLowerCase();
    if (
      typeof audioId !== 'string' ||
      !predicted ||
      !lookupPath ||
      !availablePaths.has(lookupPath) ||
      includedPaths.has(lookupPath)
    ) {
      continue;
    }
    includedPaths.add(lookupPath);
    plan.push({
      entry,
      audioId,
      artist: readText(entry['@ARTIST']) || '(unknown artist)',
      title: readText(entry['@TITLE']) || '(untitled)',
      originalLocation: originalLocation(entry),
      originalPath: '',
      sidecarPath: predicted,
    });
  }

  return plan.sort(
    (a, b) =>
      a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }) ||
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  );
}

function decodedEntryPath(entry: NmlEntry): string {
  const directory = readText(entry.LOCATION?.['@DIR'])
    .replace(/\\/g, '/')
    .replace(/\/:/g, '/');
  return `${directory}/${readText(entry.LOCATION?.['@FILE'])}`
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function candidatePath(file: IndexedAudioFileHandle): string {
  return `${file.relativeDir}/${file.filename}`.replace(/^\/|\/$/g, '').toLowerCase();
}

function findOriginalFile(
  entry: NmlEntry,
  files: readonly IndexedAudioFileHandle[],
): IndexedAudioFileHandle | null {
  const expected = decodedEntryPath(entry);
  const matches = files
    .filter((file) => expected.endsWith(`/${candidatePath(file)}`))
    .sort((a, b) => candidatePath(b).length - candidatePath(a).length);
  if (matches.length === 0) return null;
  const bestLength = candidatePath(matches[0]!).length;
  return matches.filter((file) => candidatePath(file).length === bestLength).length === 1
    ? matches[0]!
    : null;
}

function collisionSafeFilename(filename: string, used: Set<string>): string {
  const safeFilename = sanitizePlaylistFilename(filename).replace(/[. ]+$/g, '') || 'track';
  const dot = safeFilename.lastIndexOf('.');
  const base = dot > 0 ? safeFilename.slice(0, dot) : safeFilename;
  const extension = dot > 0 ? safeFilename.slice(dot) : '';
  let candidate = safeFilename;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} (${suffix})${extension}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Match stem-backed entries to their source audio and assign flat package paths. */
export function buildStemShareExportPlan(
  plan: readonly StemSharePlanItem[],
  files: readonly IndexedAudioFileHandle[],
): StemShareExportItem[] {
  const usedNames = new Set<string>();
  const output: StemShareExportItem[] = [];
  for (const item of plan) {
    const originalFile = findOriginalFile(item.entry, files);
    if (!originalFile) continue;
    output.push({
      ...item,
      originalPath: `Originals/${collisionSafeFilename(originalFile.filename, usedNames)}`,
      originalFile,
    });
  }
  return output;
}

export function createStemShareManifest(
  items: StemShareExportItem[],
  createdAt = new Date().toISOString(),
): StemShareManifest {
  return {
    format: STEM_SHARE_FORMAT,
    version: STEM_SHARE_VERSION,
    createdAt,
    entries: items.map(({ entry: _entry, originalFile: _originalFile, ...item }) => item),
  };
}

function parseManifestItem(
  value: unknown,
  index: number,
  originalsRequired: boolean,
): StemShareItem {
  if (!value || typeof value !== 'object') {
    throw new Error(`Manifest entry ${index + 1} is not an object`);
  }
  const item = value as Record<string, unknown>;
  const audioId = readText(item.audioId);
  const artist = readText(item.artist);
  const title = readText(item.title);
  const location = readText(item.originalLocation);
  const originalPath = readText(item.originalPath);
  const suppliedPath = readText(item.sidecarPath).replace(/\\/g, '/');
  const normalized = normalizeGeneratedStemPath(suppliedPath);
  if (
    !audioId ||
    !artist ||
    !title ||
    !normalized ||
    normalized !== suppliedPath.toLowerCase() ||
    (originalsRequired && !originalPath) ||
    (originalPath !== '' && (
      !/^Originals\/[^/\\]+$/.test(originalPath) ||
      originalPath.endsWith('/.') ||
      originalPath.endsWith('/..')
    ))
  ) {
    throw new Error(`Manifest entry ${index + 1} is incomplete or has an invalid path`);
  }
  const sidecarPath = predictGeneratedStemPath(audioId);
  if (sidecarPath.toLowerCase() !== normalized) {
    throw new Error(`Manifest entry ${index + 1} does not match its AUDIO_ID`);
  }
  return {
    audioId,
    artist,
    title,
    originalLocation: location,
    ...(originalPath ? { originalPath } : {}),
    sidecarPath,
  };
}

export function parseStemShareManifest(json: string): StemShareManifest {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('manifest.json is not valid JSON');
  }
  if (!value || typeof value !== 'object') {
    throw new Error('manifest.json must contain an object');
  }
  const manifest = value as Record<string, unknown>;
  if (
    manifest.format !== STEM_SHARE_FORMAT ||
    (manifest.version !== 1 && manifest.version !== STEM_SHARE_VERSION)
  ) {
    throw new Error('Unsupported stem-share manifest format or version');
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error('Stem-share manifest contains no entries');
  }
  const createdAt = readText(manifest.createdAt);
  if (!createdAt) throw new Error('Stem-share manifest is missing createdAt');
  return {
    format: STEM_SHARE_FORMAT,
    version: manifest.version,
    createdAt,
    entries: manifest.entries.map((entry, index) =>
      parseManifestItem(entry, index, manifest.version === STEM_SHARE_VERSION)),
  };
}

/** Rewrite package entries to the recipient's chosen originals directory. */
export function createRecipientEntries(
  collection: readonly NmlEntry[],
  manifest: StemShareManifest,
  recipientRoot: string,
): NmlEntry[] {
  if (!recipientRoot.trim()) throw new Error('Enter the absolute Traktor path for the originals folder');
  if (manifest.entries.some((item) => !item.originalPath)) {
    throw new Error('This legacy package does not include original music files');
  }
  const byAudioId = new Map(
    collection
      .filter((entry) => typeof entry['@AUDIO_ID'] === 'string')
      .map((entry) => [entry['@AUDIO_ID']!, entry]),
  );
  return manifest.entries.map((item, index) => {
    const entry = byAudioId.get(item.audioId);
    if (!entry) throw new Error(`stem-share.nml is missing manifest entry ${index + 1}`);
    const filename = item.originalPath!.slice('Originals/'.length);
    return {
      ...entry,
      LOCATION: locationFromRelativePath(recipientRoot.trim(), '', filename),
    };
  });
}
