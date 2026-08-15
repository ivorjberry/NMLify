import { describe, expect, it } from 'vitest';

import {
  generatedStemPathForEntry,
  hasGeneratedStem,
  normalizeGeneratedStemPath,
  predictGeneratedStemPath,
  scanGeneratedStemFileList,
  scanGeneratedStemHandle,
  type StemDirectoryHandle,
  type StemFileHandle,
} from './generatedStems';
import type { NmlEntry } from './nml';

const ENDLESS_SUMMER_AUDIO_ID =
  'ALsAKId3d3dmd3esupibusyry7yrzb3cu7u928zt283L7t3//c7v/v3Mzf//7u393u7v7Mzv7v7e/e///+7v///////+///////6is7///////7//////////////v///8z+3//t79/uz9/9rv7v/9/+//7////KdVeYh7//3f///93d7//+/u/O7u/93M/+////3//////////////v//////+IvP///////////////////////////O3d2928y6m9y7zL7+/u7e////5Eqc///////////////////////////e////////////////////////+Xm5MQAAAAAA==';
const ENDLESS_SUMMER_PATH = '079/P4GY4RBERYW4MDYOUDPUCMBQJA5C.stem.mp4';

function entry(audioId?: string): NmlEntry {
  return {
    ...(audioId === undefined ? {} : { '@AUDIO_ID': audioId }),
    LOCATION: { '@VOLUME': 'C:', '@DIR': '/Music/', '@FILE': 'track.m4a' },
  };
}

function file(name: string): StemFileHandle {
  return { kind: 'file', name };
}

function directory(
  name: string,
  children: Array<StemDirectoryHandle | StemFileHandle>,
): StemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      yield* children;
    },
  };
}

describe('generated stem path prediction', () => {
  it('reproduces the logged Endless Summer sidecar path', () => {
    expect(predictGeneratedStemPath(ENDLESS_SUMMER_AUDIO_ID)).toBe(ENDLESS_SUMMER_PATH);
  });

  it('returns null for missing or malformed entry AUDIO_ID values', () => {
    expect(generatedStemPathForEntry(entry())).toBeNull();
    expect(generatedStemPathForEntry(entry('not-base64'))).toBeNull();
  });

  it('matches predicted paths case-insensitively after scan normalization', () => {
    const paths = new Set([ENDLESS_SUMMER_PATH.toLowerCase()]);
    expect(hasGeneratedStem(entry(ENDLESS_SUMMER_AUDIO_ID), paths)).toBe(true);
  });
});

describe('generated stem path scanning', () => {
  it('normalizes only paths following Traktor generated-stem layout', () => {
    expect(normalizeGeneratedStemPath(`Stems\\${ENDLESS_SUMMER_PATH}`)).toBe(
      ENDLESS_SUMMER_PATH.toLowerCase(),
    );
    expect(normalizeGeneratedStemPath('079/Endless Summer.stem.mp4')).toBeNull();
    expect(normalizeGeneratedStemPath('track.mp3')).toBeNull();
  });

  it('recursively scans names without reading file contents', async () => {
    const root = directory('Stems', [
      directory('079', [
        file('P4GY4RBERYW4MDYOUDPUCMBQJA5C.stem.mp4'),
        file('notes.txt'),
      ]),
      directory('Other', [file('packaged.stem.mp4')]),
    ]);
    expect(await scanGeneratedStemHandle(root)).toEqual(
      new Set([ENDLESS_SUMMER_PATH.toLowerCase()]),
    );
  });

  it('supports legacy webkitdirectory file selections', () => {
    const files = [
      { name: 'P4GY4RBERYW4MDYOUDPUCMBQJA5C.stem.mp4', webkitRelativePath: `Stems/${ENDLESS_SUMMER_PATH}` },
      { name: 'cover.jpg', webkitRelativePath: 'Stems/079/cover.jpg' },
    ];
    expect(scanGeneratedStemFileList(files)).toEqual(
      new Set([ENDLESS_SUMMER_PATH.toLowerCase()]),
    );
  });
});
