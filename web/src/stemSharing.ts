import {
  generatedStemPathForEntry,
  normalizeGeneratedStemPath,
  predictGeneratedStemPath,
} from './generatedStems';
import type { NmlEntry } from './nml';

export const STEM_SHARE_FORMAT = 'nmlify-stem-share';
export const STEM_SHARE_VERSION = 1;

export interface StemShareItem {
  audioId: string;
  artist: string;
  title: string;
  originalLocation: string;
  sidecarPath: string;
}

export interface StemShareManifest {
  format: typeof STEM_SHARE_FORMAT;
  version: typeof STEM_SHARE_VERSION;
  createdAt: string;
  entries: StemShareItem[];
}

export interface StemSharePlanItem extends StemShareItem {
  entry: NmlEntry;
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
      sidecarPath: predicted,
    });
  }

  return plan.sort(
    (a, b) =>
      a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }) ||
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  );
}

export function createStemShareManifest(
  items: StemSharePlanItem[],
  createdAt = new Date().toISOString(),
): StemShareManifest {
  return {
    format: STEM_SHARE_FORMAT,
    version: STEM_SHARE_VERSION,
    createdAt,
    entries: items.map(({ entry: _entry, ...item }) => item),
  };
}

function parseManifestItem(value: unknown, index: number): StemShareItem {
  if (!value || typeof value !== 'object') {
    throw new Error(`Manifest entry ${index + 1} is not an object`);
  }
  const item = value as Record<string, unknown>;
  const audioId = readText(item.audioId);
  const artist = readText(item.artist);
  const title = readText(item.title);
  const location = readText(item.originalLocation);
  const suppliedPath = readText(item.sidecarPath).replace(/\\/g, '/');
  const normalized = normalizeGeneratedStemPath(suppliedPath);
  if (!audioId || !artist || !title || !normalized || normalized !== suppliedPath.toLowerCase()) {
    throw new Error(`Manifest entry ${index + 1} is incomplete or has an invalid path`);
  }
  const sidecarPath = predictGeneratedStemPath(audioId);
  if (sidecarPath.toLowerCase() !== normalized) {
    throw new Error(`Manifest entry ${index + 1} does not match its AUDIO_ID`);
  }
  return { audioId, artist, title, originalLocation: location, sidecarPath };
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
  if (manifest.format !== STEM_SHARE_FORMAT || manifest.version !== STEM_SHARE_VERSION) {
    throw new Error('Unsupported stem-share manifest format or version');
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error('Stem-share manifest contains no entries');
  }
  const createdAt = readText(manifest.createdAt);
  if (!createdAt) throw new Error('Stem-share manifest is missing createdAt');
  return {
    format: STEM_SHARE_FORMAT,
    version: STEM_SHARE_VERSION,
    createdAt,
    entries: manifest.entries.map(parseManifestItem),
  };
}
