import { describe, expect, it } from 'vitest';

import type { NmlEntry } from './nml';
import {
  STEM_SHARE_VERSION,
  buildStemShareExportPlan,
  buildStemSharePlan,
  createRecipientEntries,
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

const originalFile = {
  relativeDir: 'Alan Walker',
  filename: 'Endless Summer.m4a',
  handle: { kind: 'file' as const, name: 'Endless Summer.m4a' },
};

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

describe('buildStemShareExportPlan', () => {
  it('matches originals by collection path suffix', () => {
    const stemPlan = buildStemSharePlan([entry()], new Set([SIDECAR.toLowerCase()]));
    const plan = buildStemShareExportPlan(stemPlan, [originalFile]);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      originalPath: 'Originals/Endless Summer.m4a',
      originalFile,
    });
  });

  it('omits missing originals and gives duplicate filenames unique flat paths', () => {
    const secondAudioId = AUDIO_ID.replace(/^A/, 'B');
    const second = entry({
      '@AUDIO_ID': secondAudioId,
      '@ARTIST': 'Other Artist',
      LOCATION: { '@VOLUME': 'D:', '@DIR': '/:Other/:', '@FILE': 'Endless Summer.m4a' },
    });
    const stemPlan = [
      ...buildStemSharePlan([entry()], new Set([SIDECAR.toLowerCase()])),
      {
        ...buildStemSharePlan([entry()], new Set([SIDECAR.toLowerCase()]))[0]!,
        entry: second,
        audioId: secondAudioId,
      },
    ];
    const duplicate = {
      ...originalFile,
      relativeDir: 'Other',
      handle: { kind: 'file' as const, name: 'Endless Summer.m4a' },
    };
    expect(buildStemShareExportPlan(stemPlan, [originalFile, duplicate]).map(
      (item) => item.originalPath,
    )).toEqual([
      'Originals/Endless Summer.m4a',
      'Originals/Endless Summer (2).m4a',
    ]);
    expect(buildStemShareExportPlan(stemPlan, [])).toEqual([]);
  });
});

describe('stem share manifests', () => {
  it('round-trips a generated manifest', () => {
    const plan = buildStemShareExportPlan(
      buildStemSharePlan([entry()], new Set([SIDECAR.toLowerCase()])),
      [originalFile],
    );
    const manifest = createStemShareManifest(plan, '2026-08-17T12:00:00.000Z');
    expect(parseStemShareManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('rejects paths that do not match the AUDIO_ID', () => {
    const plan = buildStemShareExportPlan(
      buildStemSharePlan([entry()], new Set([SIDECAR.toLowerCase()])),
      [originalFile],
    );
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
          version: STEM_SHARE_VERSION,
          createdAt: new Date().toISOString(),
          entries: [],
        }),
      ),
    ).toThrow('contains no entries');
  });

  it('continues to accept legacy sidecar-only manifests', () => {
    const legacy = {
      format: 'nmlify-stem-share',
      version: 1,
      createdAt: '2026-08-17T12:00:00.000Z',
      entries: [{
        audioId: AUDIO_ID,
        artist: 'Alan Walker & Zak Abel',
        title: 'Endless Summer',
        originalLocation: 'C:/:Music/:Alan Walker/:Endless Summer.m4a',
        sidecarPath: SIDECAR,
      }],
    };
    expect(parseStemShareManifest(JSON.stringify(legacy))).toEqual(legacy);
  });

  it('rewrites recipient NML locations to the installed originals folder', () => {
    const plan = buildStemShareExportPlan(
      buildStemSharePlan([entry()], new Set([SIDECAR.toLowerCase()])),
      [originalFile],
    );
    const manifest = createStemShareManifest(plan);
    expect(createRecipientEntries([entry()], manifest, 'D:\\Music\\Shared Stems')[0]!.LOCATION)
      .toEqual({
        '@VOLUME': 'D:',
        '@DIR': '/:Music/:Shared Stems/:',
        '@FILE': 'Endless Summer.m4a',
      });
  });
});
