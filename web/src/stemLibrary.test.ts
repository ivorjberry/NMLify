import { describe, expect, it } from 'vitest';

import type { NmlEntry } from './nml';
import {
  STEM_COMMENT_MARKER,
  buildAllStemEntries,
} from './stemLibrary';

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

describe('buildAllStemEntries', () => {
  it('includes packaged and verified generated stems but excludes ordinary tracks', () => {
    const packaged = entry('packaged.stem.mp4', { STEMS: { '@MASTER_GAIN': '0.0' } });
    const generated = entry('generated.m4a', { '@AUDIO_ID': AUDIO_ID });
    const ordinary = entry('ordinary.mp3');

    expect(buildAllStemEntries([packaged, generated, ordinary], new Set([SIDECAR]), false))
      .toEqual([packaged, generated]);
  });

  it('appends an idempotent COMMENT2 marker without mutating source entries', () => {
    const source = entry('packaged.stem.mp4', {
      STEMS: {},
      INFO: { '@COMMENT2': 'existing note' },
    });
    const first = buildAllStemEntries([source], new Set(), true)[0]!;
    const second = buildAllStemEntries([first], new Set(), true)[0]!;

    expect(first.INFO?.['@COMMENT2']).toBe(`existing note ${STEM_COMMENT_MARKER}`);
    expect(second.INFO?.['@COMMENT2']).toBe(`existing note ${STEM_COMMENT_MARKER}`);
    expect(source.INFO?.['@COMMENT2']).toBe('existing note');
  });

  it('de-duplicates repeated collection locations', () => {
    const packaged = entry('duplicate.stem.mp4', { STEMS: {} });
    expect(buildAllStemEntries([packaged, { ...packaged }], new Set(), false)).toHaveLength(1);
  });
});
