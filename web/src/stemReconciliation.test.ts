import { describe, expect, it } from 'vitest';

import type { NmlEntry } from './nml';
import {
  formatStemReconciliationReport,
  recoverOrphansFromBackups,
  reconcileGeneratedStems,
} from './stemReconciliation';

const AUDIO_ID =
  'ALsAKId3d3dmd3esupibusyry7yrzb3cu7u928zt283L7t3//c7v/v3Mzf//7u393u7v7Mzv7v7e/e///+7v///////+///////6is7///////7//////////////v///8z+3//t79/uz9/9rv7v/9/+//7////KdVeYh7//3f///93d7//+/u/O7u/93M/+////3//////////////v//////+IvP///////////////////////////O3d2928y6m9y7zL7+/u7e////5Eqc///////////////////////////e////////////////////////+Xm5MQAAAAAA==';
const SIDECAR = '079/p4gy4rberyw4mdyoudpucmbqja5c.stem.mp4';

function entry(file: string, overrides: Partial<NmlEntry> = {}): NmlEntry {
  return {
    '@ARTIST': 'Artist',
    '@TITLE': file,
    LOCATION: { '@VOLUME': 'C:', '@DIR': '/:Music/:', '@FILE': file },
    ...overrides,
  };
}

describe('reconcileGeneratedStems', () => {
  it('reports mapped and orphaned sidecars', () => {
    const report = reconcileGeneratedStems(
      [entry('mapped.m4a', { '@AUDIO_ID': AUDIO_ID })],
      new Set([SIDECAR, '001/aaaaaaaaaaaaaaaaaaaaaaaaaaaa.stem.mp4']),
    );
    expect(report.mappedSidecars).toBe(1);
    expect(report.orphanedSidecars).toEqual([
      '001/aaaaaaaaaaaaaaaaaaaaaaaaaaaa.stem.mp4',
    ]);
  });

  it('reports duplicate mappings and marked tracks missing sidecars', () => {
    const marked = {
      '@AUDIO_ID': AUDIO_ID,
      INFO: { '@COMMENT2': 'set prep NMLIFY_STEM' },
    };
    const report = reconcileGeneratedStems(
      [entry('first.m4a', marked), entry('second.m4a', marked)],
      new Set(),
    );
    expect(report.duplicateMappings).toHaveLength(1);
    expect(report.missingMarkedSidecars).toHaveLength(2);
  });

  it('does not expect generated sidecars for packaged stems', () => {
    const report = reconcileGeneratedStems([
      entry('packaged.stem.mp4', {
        STEMS: {},
        INFO: { '@COMMENT2': 'NMLIFY_STEM' },
      }),
    ], new Set());
    expect(report.missingMarkedSidecars).toEqual([]);
    expect(report.unresolvedMarkedEntries).toEqual([]);
  });

  it('formats a readable report', () => {
    const report = reconcileGeneratedStems([], new Set(['001/orphan.stem.mp4']));
    expect(formatStemReconciliationReport(report)).toContain('Orphaned sidecars (1)');
  });

  it('recovers orphan mappings from the newest matching backup', () => {
    const oldEntry = entry('old.m4a', { '@AUDIO_ID': AUDIO_ID });
    const newerEntry = entry('newer.m4a', { '@AUDIO_ID': AUDIO_ID });
    const result = recoverOrphansFromBackups([SIDECAR], [
      { filename: 'old.nml', timestamp: 1, entries: [oldEntry] },
      { filename: 'new.nml', timestamp: 2, entries: [newerEntry] },
    ]);
    expect(result.recovered).toEqual([{
      sidecarPath: SIDECAR,
      entry: newerEntry,
      backupFilename: 'new.nml',
      backupTimestamp: 2,
    }]);
    expect(result.unresolvedPaths).toEqual([]);
  });
});
