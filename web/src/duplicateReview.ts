import { ratio as fuzzRatio } from 'fuzzball';

import { getBitrateKbps, getPlayCount, type NmlEntry } from './nml';

export type DuplicateConfidence = 'exact' | 'likely' | 'possible';

export interface DuplicateReviewEntry {
  entry: NmlEntry;
  artist: string;
  title: string;
  location: string;
  durationSeconds: number | null;
  bitrateKbps: number | null;
  fileSize: number | null;
  playCount: number | null;
}

export interface DuplicateReviewGroup {
  id: number;
  confidence: DuplicateConfidence;
  reasons: string[];
  entries: DuplicateReviewEntry[];
}

interface MatchEdge {
  left: number;
  right: number;
  confidence: DuplicateConfidence;
  reason: string;
}

const VERSION_TOKENS = [
  'acapella',
  'clean',
  'dirty',
  'edit',
  'extended',
  'instrumental',
  'live',
  'mix',
  'radio',
  'remaster',
  'remix',
] as const;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function versionSignature(title: string): string {
  const tokens = new Set(normalize(title).split(' '));
  return VERSION_TOKENS.filter((token) => tokens.has(token)).join('|');
}

function location(entry: NmlEntry): string {
  const value = entry.LOCATION;
  return `${value?.['@VOLUME'] ?? ''}${value?.['@DIR'] ?? ''}${value?.['@FILE'] ?? ''}`;
}

function describe(entry: NmlEntry): DuplicateReviewEntry {
  const info = entry.INFO;
  return {
    entry,
    artist: text(entry['@ARTIST']) || '(unknown artist)',
    title: text(entry['@TITLE']) || '(untitled)',
    location: location(entry),
    durationSeconds: numberValue(info?.['@PLAYTIME_FLOAT']) ?? numberValue(info?.['@PLAYTIME']),
    bitrateKbps: getBitrateKbps(entry),
    fileSize: numberValue(info?.['@FILESIZE']),
    playCount: getPlayCount(entry),
  };
}

function durationDifference(
  left: DuplicateReviewEntry,
  right: DuplicateReviewEntry,
): number | null {
  return left.durationSeconds !== null && right.durationSeconds !== null
    ? Math.abs(left.durationSeconds - right.durationSeconds)
    : null;
}

function confidenceRank(value: DuplicateConfidence): number {
  return value === 'exact' ? 3 : value === 'likely' ? 2 : 1;
}

/** Find conservative duplicate candidates without opening any audio files. */
export function findDuplicateReviewGroups(
  collection: readonly NmlEntry[],
): DuplicateReviewGroup[] {
  const candidates = collection
    .filter((entry) => location(entry) !== '')
    .map(describe);
  const parents = candidates.map((_, index) => index);
  const edges: MatchEdge[] = [];

  function find(index: number): number {
    let root = index;
    while (parents[root] !== root) root = parents[root]!;
    while (parents[index] !== index) {
      const next = parents[index]!;
      parents[index] = root;
      index = next;
    }
    return root;
  }

  function connect(
    left: number,
    right: number,
    confidence: DuplicateConfidence,
    reason: string,
  ): void {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
    edges.push({ left, right, confidence, reason });
  }

  const byLocation = new Map<string, number>();
  const byAudioId = new Map<string, number>();
  for (const [index, candidate] of candidates.entries()) {
    const normalizedLocation = candidate.location.toLowerCase();
    const locationMatch = byLocation.get(normalizedLocation);
    if (locationMatch !== undefined) {
      connect(locationMatch, index, 'exact', 'same collection location');
    } else {
      byLocation.set(normalizedLocation, index);
    }

    const audioId = text(candidate.entry['@AUDIO_ID']);
    if (!audioId) continue;
    const audioMatch = byAudioId.get(audioId);
    if (audioMatch !== undefined) {
      connect(audioMatch, index, 'exact', 'same AUDIO_ID');
    } else {
      byAudioId.set(audioId, index);
    }
  }

  const metadataBlocks = new Map<string, number[]>();
  for (const [index, candidate] of candidates.entries()) {
    const artist = normalize(candidate.artist);
    const titleToken = normalize(candidate.title).split(' ')[0];
    if (!artist || artist === 'unknown artist') continue;
    if (!titleToken) continue;
    const blockKey = `${artist}\u0000${titleToken}`;
    const bucket = metadataBlocks.get(blockKey) ?? [];
    bucket.push(index);
    metadataBlocks.set(blockKey, bucket);
  }

  for (const bucket of metadataBlocks.values()) {
    for (let leftIndex = 0; leftIndex < bucket.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bucket.length; rightIndex += 1) {
        const left = candidates[bucket[leftIndex]!]!;
        const right = candidates[bucket[rightIndex]!]!;
        if (left.location.toLowerCase() === right.location.toLowerCase()) continue;
        if (
          text(left.entry['@AUDIO_ID']) &&
          text(left.entry['@AUDIO_ID']) === text(right.entry['@AUDIO_ID'])
        ) continue;

        const leftTitle = normalize(left.title);
        const rightTitle = normalize(right.title);
        const durationDelta = durationDifference(left, right);
        if (leftTitle === rightTitle) {
          if (durationDelta === null) {
            connect(bucket[leftIndex]!, bucket[rightIndex]!, 'possible', 'same artist and title');
          } else if (durationDelta <= 2) {
            connect(
              bucket[leftIndex]!,
              bucket[rightIndex]!,
              'likely',
              `same artist/title; duration differs by ${durationDelta.toFixed(1)}s`,
            );
          }
          continue;
        }

        if (
          durationDelta !== null &&
          durationDelta <= 2 &&
          versionSignature(left.title) === versionSignature(right.title) &&
          fuzzRatio(leftTitle, rightTitle) >= 92
        ) {
          connect(
            bucket[leftIndex]!,
            bucket[rightIndex]!,
            'possible',
            `very similar title; duration differs by ${durationDelta.toFixed(1)}s`,
          );
        }
      }
    }
  }

  const components = new Map<number, number[]>();
  for (let index = 0; index < candidates.length; index += 1) {
    const root = find(index);
    const component = components.get(root) ?? [];
    component.push(index);
    components.set(root, component);
  }

  const groups = [...components.values()]
    .filter((indices) => indices.length > 1)
    .map((indices) => {
      const members = new Set(indices);
      const groupEdges = edges.filter(
        (edge) => members.has(edge.left) && members.has(edge.right),
      );
      const confidence = groupEdges.reduce<DuplicateConfidence>(
        (lowest, edge) =>
          confidenceRank(edge.confidence) < confidenceRank(lowest)
            ? edge.confidence
            : lowest,
        'exact',
      );
      return {
        id: 0,
        confidence,
        reasons: [...new Set(groupEdges.map((edge) => edge.reason))],
        entries: indices
          .map((index) => candidates[index]!)
          .sort((a, b) => a.location.localeCompare(b.location)),
      };
    })
    .sort((a, b) =>
      a.entries[0]!.artist.localeCompare(b.entries[0]!.artist) ||
      a.entries[0]!.title.localeCompare(b.entries[0]!.title));

  return groups.map((group, index) => ({ ...group, id: index + 1 }));
}

export function formatDuplicateReviewReport(groups: readonly DuplicateReviewGroup[]): string {
  const lines = ['NMLify Duplicate Review', '', `Groups: ${groups.length}`, ''];
  for (const group of groups) {
    lines.push(
      `Group ${group.id} [${group.confidence.toUpperCase()}]`,
      `Reasons: ${group.reasons.join('; ')}`,
    );
    for (const item of group.entries) {
      lines.push(
        `- ${item.artist} - ${item.title}`,
        `  ${item.location}`,
        `  Duration: ${item.durationSeconds ?? 'unknown'}s | ` +
          `Bitrate: ${item.bitrateKbps ?? 'unknown'} kbps | ` +
          `File size: ${item.fileSize ?? 'unknown'} | Plays: ${item.playCount ?? 0}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
