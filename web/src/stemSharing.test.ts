import { describe, expect, it } from 'vitest';

import type { NmlEntry } from './nml';
import {
  buildStemSharePlan,
  createStemShareManifest,
  parseStemShareManifest,
} from './stemSharing';

const AUDIO_ID =
  'ALsAKId3d3dmd3esupibusyry7yrzb3cu7u928zt283L7t3//c7v/v3Mzf//7u393u7v7Mzv7v7e/e///+7v///////+///////6is7///////7//////////////v///8z+3//t79/uz9/9rv7v/9/+//7////KdVeYh7//3f///93d7//+/u/O7u/93M/+////3//////////////v//////+IvP///////////////////////////O3d2928y6m9y7zL7+/u7e////5Eqc///////////////////////////e////////////////////////+Xm5MQAAAAAA==';
const SIDECAR = '079/P4GY4RBERYW4MDYOUDPUCMBQJA5C.stem.mp4';

function entry(overrides: Partial<NmlEntry> = {}): NmlEntry {
  return {
    '@AUDIO_ID': AUDIO_ID,
    '@ARTIST': 'Alan Walker & Zak Abel',
    '@TITLE': 'Endless Summer',
    LOCATION: {
      '@VOLUME': 'C:',
      '@DIR': '/:Music/:Alan Walker/:',
      '@FILE': 'Endless Summer.m4a',
    },
    ...overrides,
  };
}

describe('buildStemSharePlan', () => {
  it('returns only entries whose predicted sidecar exists', () => {
    const plan = buildStemSharePlan(
      [entry(), entry({ '@AUDIO_ID': undefined, '@TITLE': 'No stem' })],
      new Set([SIDECAR.toLowerCase()]),
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      artist: 'Alan Walker & Zak Abel',
      title: 'Endless Summer',
      sidecarPath: SIDECAR,
      originalLocation: 'C:/:Music/:Alan Walker/:Endless Summer.m4a',
    });
  });

  it('de-duplicates collection entries resolving to the same sidecar', () => {
    expect(buildStemSharePlan([entry(), entry()], new Set([SIDECAR.toLowerCase()]))).toHaveLength(1);
  });
});

describe('stem share manifests', () => {
  it('round-trips a generated manifest', () => {
    const plan = buildStemSharePlan([entry()], new Set([SIDECAR.toLowerCase()]));
    const manifest = createStemShareManifest(plan, '2026-08-17T12:00:00.000Z');
    expect(parseStemShareManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('rejects paths that do not match the AUDIO_ID', () => {
    const plan = buildStemSharePlan([entry()], new Set([SIDECAR.toLowerCase()]));
    const manifest = createStemShareManifest(plan);
    manifest.entries[0]!.sidecarPath =
      '001/aaaaaaaaaaaaaaaaaaaaaaaaaaaa.stem.mp4';
    expect(() => parseStemShareManifest(JSON.stringify(manifest))).toThrow(
      'does not match its AUDIO_ID',
    );
  });

  it('rejects unsupported and empty manifests', () => {
    expect(() => parseStemShareManifest('{}')).toThrow('Unsupported');
    expect(() =>
      parseStemShareManifest(
        JSON.stringify({
          format: 'nmlify-stem-share',
          version: 1,
          createdAt: new Date().toISOString(),
          entries: [],
        }),
      ),
    ).toThrow('contains no entries');
  });
});
