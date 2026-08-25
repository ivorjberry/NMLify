import { generatedStemPathForEntry } from './generatedStems';
import { isStemEntry, type NmlEntry } from './nml';
import { hasStemCommentMarker } from './stemLibrary';

export interface ReconciliationEntry {
  artist: string;
  title: string;
  location: string;
  expectedPath: string | null;
}

export interface DuplicateStemMapping {
  sidecarPath: string;
  entries: ReconciliationEntry[];
}

export interface StemReconciliationReport {
  collectionEntries: number;
  sidecarFiles: number;
  mappedSidecars: number;
  orphanedSidecars: string[];
  duplicateMappings: DuplicateStemMapping[];
  missingMarkedSidecars: ReconciliationEntry[];
  unresolvedMarkedEntries: ReconciliationEntry[];
}

export interface ReconciliationBackup {
  filename: string;
  timestamp: number;
  entries: readonly NmlEntry[];
}

export interface RecoveredOrphan {
  sidecarPath: string;
  entry: NmlEntry;
  backupFilename: string;
  backupTimestamp: number;
}

export interface OrphanRecoveryResult {
  recovered: RecoveredOrphan[];
  unresolvedPaths: string[];
}

function describeEntry(entry: NmlEntry, expectedPath: string | null): ReconciliationEntry {
  const location = entry.LOCATION;
  return {
    artist: typeof entry['@ARTIST'] === 'string' ? entry['@ARTIST'] : '(unknown artist)',
    title: typeof entry['@TITLE'] === 'string' ? entry['@TITLE'] : '(untitled)',
    location: `${location?.['@VOLUME'] ?? ''}${location?.['@DIR'] ?? ''}${location?.['@FILE'] ?? ''}`,
    expectedPath,
  };
}

export function reconcileGeneratedStems(
  collection: readonly NmlEntry[],
  availablePaths: ReadonlySet<string>,
): StemReconciliationReport {
  const mappings = new Map<string, ReconciliationEntry[]>();
  const missingMarkedSidecars: ReconciliationEntry[] = [];
  const unresolvedMarkedEntries: ReconciliationEntry[] = [];

  for (const entry of collection) {
    const expectedPath = generatedStemPathForEntry(entry);
    const normalized = expectedPath?.toLowerCase() ?? null;
    if (normalized) {
      const mapped = mappings.get(normalized) ?? [];
      mapped.push(describeEntry(entry, expectedPath));
      mappings.set(normalized, mapped);
    }

    if (!hasStemCommentMarker(entry) || isStemEntry(entry)) continue;
    const described = describeEntry(entry, expectedPath);
    if (!normalized) {
      unresolvedMarkedEntries.push(described);
    } else if (!availablePaths.has(normalized)) {
      missingMarkedSidecars.push(described);
    }
  }

  const orphanedSidecars = [...availablePaths]
    .filter((path) => !mappings.has(path.toLowerCase()))
    .sort();
  const duplicateMappings = [...mappings.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([sidecarPath, entries]) => ({ sidecarPath, entries }))
    .sort((a, b) => a.sidecarPath.localeCompare(b.sidecarPath));
  const mappedSidecars = [...availablePaths]
    .filter((path) => mappings.has(path.toLowerCase()))
    .length;

  return {
    collectionEntries: collection.length,
    sidecarFiles: availablePaths.size,
    mappedSidecars,
    orphanedSidecars,
    duplicateMappings,
    missingMarkedSidecars,
    unresolvedMarkedEntries,
  };
}

/** Match orphaned sidecars to their newest known entries in collection backups. */
export function recoverOrphansFromBackups(
  orphanedPaths: readonly string[],
  backups: readonly ReconciliationBackup[],
): OrphanRecoveryResult {
  const unresolved = new Set(orphanedPaths.map((path) => path.toLowerCase()));
  const originalPaths = new Map(orphanedPaths.map((path) => [path.toLowerCase(), path]));
  const recovered: RecoveredOrphan[] = [];

  for (const backup of [...backups].sort((a, b) => b.timestamp - a.timestamp)) {
    if (unresolved.size === 0) break;
    for (const entry of backup.entries) {
      const predicted = generatedStemPathForEntry(entry)?.toLowerCase();
      if (!predicted || !unresolved.has(predicted)) continue;
      recovered.push({
        sidecarPath: originalPaths.get(predicted) ?? predicted,
        entry,
        backupFilename: backup.filename,
        backupTimestamp: backup.timestamp,
      });
      unresolved.delete(predicted);
    }
  }

  return {
    recovered,
    unresolvedPaths: [...unresolved].map((path) => originalPaths.get(path) ?? path).sort(),
  };
}

function entryLine(entry: ReconciliationEntry): string {
  return `${entry.artist} - ${entry.title} | ${entry.location}` +
    (entry.expectedPath ? ` | ${entry.expectedPath}` : '');
}

export function formatStemReconciliationReport(report: StemReconciliationReport): string {
  const lines = [
    'NMLify Stem Reconciliation',
    '',
    `Collection entries: ${report.collectionEntries}`,
    `Generated sidecars scanned: ${report.sidecarFiles}`,
    `Sidecars mapped to collection entries: ${report.mappedSidecars}`,
    '',
    `Orphaned sidecars (${report.orphanedSidecars.length})`,
    ...report.orphanedSidecars.map((path) => `- ${path}`),
    '',
    `Duplicate mappings (${report.duplicateMappings.length})`,
    ...report.duplicateMappings.flatMap((duplicate) => [
      `- ${duplicate.sidecarPath}`,
      ...duplicate.entries.map((entry) => `  - ${entryLine(entry)}`),
    ]),
    '',
    `Marked stems missing sidecars (${report.missingMarkedSidecars.length})`,
    ...report.missingMarkedSidecars.map((entry) => `- ${entryLine(entry)}`),
    '',
    `Marked stems with unusable AUDIO_ID (${report.unresolvedMarkedEntries.length})`,
    ...report.unresolvedMarkedEntries.map((entry) => `- ${entryLine(entry)}`),
    '',
  ];
  return lines.join('\n');
}
