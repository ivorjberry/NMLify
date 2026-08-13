import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';

import {
  buildNmlPlaylist,
  getBitrateKbps,
  getPlayCount,
  isStemEntry,
  loadCollection,
  type NmlEntry,
  sanitizePlaylistFilename,
} from './nml';
import { writeNmlPlaylist } from './nmlWriter';

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  isArray: (name: string) => name === 'ENTRY' || name === 'NODE',
  parseAttributeValue: false,
  parseTagValue: false,
});

function makeEntry(title: string, artist: string, fileName: string, stem = false): NmlEntry {
  const entry: NmlEntry = {
    '@TITLE': title,
    '@ARTIST': artist,
    LOCATION: { '@DIR': '/:Music/:', '@FILE': fileName, '@VOLUME': 'D:' },
  };
  if (stem) entry.STEMS = { '@MASTER_GAIN': '0.0' };
  return entry;
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'crate-nml-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('loadCollection', () => {
  it('returns a list with required fields', async () => {
    const xml =
      '<NML><COLLECTION ENTRIES="2">' +
      '<ENTRY TITLE="A" ARTIST="X"><LOCATION DIR="/:Music/:" FILE="a.mp3" VOLUME="D:"/></ENTRY>' +
      '<ENTRY TITLE="B" ARTIST="Y"><LOCATION DIR="/:Music/:" FILE="b.mp3" VOLUME="D:"/></ENTRY>' +
      '</COLLECTION></NML>';
    const entries = loadCollection(xml);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.['@TITLE']).toBe('A');
    expect(entries[0]?.LOCATION).toBeDefined();
  });

  it('normalizes a single ENTRY to a list', () => {
    const xml =
      '<NML><COLLECTION ENTRIES="1">' +
      '<ENTRY TITLE="Solo" ARTIST="Only One">' +
      '<LOCATION DIR="/:Music/:" FILE="solo.mp3" VOLUME="D:"/>' +
      '</ENTRY></COLLECTION></NML>';
    const entries = loadCollection(xml);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.['@TITLE']).toBe('Solo');
  });

  it('returns [] when COLLECTION has no entries', () => {
    expect(loadCollection('<NML><COLLECTION ENTRIES="0"/></NML>')).toEqual([]);
  });

  it('returns [] when COLLECTION is missing entirely', () => {
    expect(loadCollection('<NML><HEAD COMPANY="x" PROGRAM="y"/></NML>')).toEqual([]);
  });
});

describe('sanitizePlaylistFilename', () => {
  it('strips illegal Windows chars', () => {
    expect(sanitizePlaylistFilename('weird: name*?')).toBe('weird name');
  });

  it('falls back to "playlist" when input collapses to empty', () => {
    expect(sanitizePlaylistFilename('***')).toBe('playlist');
    expect(sanitizePlaylistFilename('   ')).toBe('playlist');
    expect(sanitizePlaylistFilename('')).toBe('playlist');
  });
});

describe('getPlayCount', () => {
  const baseEntry = (info?: Record<string, unknown>): NmlEntry =>
    ({
      LOCATION: { '@VOLUME': 'C:', '@DIR': '/Music/', '@FILE': 'a.mp3' },
      ...(info ? { INFO: info } : {}),
    }) as NmlEntry;

  it('parses a string PLAYCOUNT attribute', () => {
    expect(getPlayCount(baseEntry({ '@PLAYCOUNT': '7' }))).toBe(7);
  });

  it('accepts a numeric PLAYCOUNT value', () => {
    expect(getPlayCount(baseEntry({ '@PLAYCOUNT': 3 }))).toBe(3);
  });

  it('returns null when INFO is missing', () => {
    expect(getPlayCount(baseEntry())).toBeNull();
  });

  it('returns null when PLAYCOUNT is absent', () => {
    expect(getPlayCount(baseEntry({ '@BITRATE': '128000' }))).toBeNull();
  });

  it('returns null for non-numeric PLAYCOUNT', () => {
    expect(getPlayCount(baseEntry({ '@PLAYCOUNT': 'lots' }))).toBeNull();
  });
});

describe('collection entry file details', () => {
  it('returns the rounded bitrate in kbps', () => {
    const entry = makeEntry('Track', 'Artist', 'track.mp3');
    entry.INFO = { '@BITRATE': '299672' };
    expect(getBitrateKbps(entry)).toBe(300);
  });

  it('returns null when bitrate is missing or invalid', () => {
    const entry = makeEntry('Track', 'Artist', 'track.mp3');
    expect(getBitrateKbps(entry)).toBeNull();
    entry.INFO = { '@BITRATE': 'unknown' };
    expect(getBitrateKbps(entry)).toBeNull();
  });

  it('detects both .stem.mp4 and Traktor-generated stem entries', () => {
    expect(isStemEntry(makeEntry('Track', 'Artist', 'track.mp3'))).toBe(false);
    expect(isStemEntry(makeEntry('Packaged Stem', 'Artist', 'track.stem.mp4', true))).toBe(true);
    expect(isStemEntry(makeEntry('Generated Stem', 'Artist', 'track.m4a', true))).toBe(true);
  });
});

describe('buildNmlPlaylist', () => {
  it('emits both COLLECTION and PLAYLISTS with correct counts and key paths', () => {
    const tracks = [
      makeEntry('Song A', 'Artist 1', 'a.mp3'),
      makeEntry('Song B', 'Artist 2', 'b.mp3'),
    ];
    const xml = buildNmlPlaylist('Set', tracks);
    const parsed = PARSER.parse(xml) as Record<string, any>;
    const nml = parsed.NML;
    expect(nml.COLLECTION['@ENTRIES']).toBe('2');
    const node = nml.PLAYLISTS.NODE[0];
    expect(node['@NAME']).toBe('Set');
    expect(node.PLAYLIST['@ENTRIES']).toBe('2');
    const keys = node.PLAYLIST.ENTRY;
    expect(keys).toHaveLength(2);
    expect(keys[0].PRIMARYKEY['@KEY']).toBe('D:/:Music/:a.mp3');
    expect(keys[0].PRIMARYKEY['@TYPE']).toBe('TRACK');
  });

  it('sets PRIMARYKEY @TYPE=STEM when STEMS is present', () => {
    const xml = buildNmlPlaylist('Stems', [makeEntry('Stem Track', 'DJ', 's.mp3', true)]);
    const parsed = PARSER.parse(xml) as Record<string, any>;
    const key = parsed.NML.PLAYLISTS.NODE[0].PLAYLIST.ENTRY[0].PRIMARYKEY;
    expect(key['@TYPE']).toBe('STEM');
  });

  it('skips entries that lack a complete LOCATION', () => {
    const incomplete: NmlEntry = {
      '@TITLE': 'broken',
      '@ARTIST': 'x',
      // Cast through unknown to express the malformed shape in tests.
      LOCATION: { '@VOLUME': 'D:' } as unknown as NmlEntry['LOCATION'],
    };
    const ok = makeEntry('Fine', 'Y', 'fine.mp3');
    const xml = buildNmlPlaylist('Mixed', [incomplete, ok]);
    const parsed = PARSER.parse(xml) as Record<string, any>;
    // Only the well-formed entry produces a PRIMARYKEY.
    expect(parsed.NML.PLAYLISTS.NODE[0].PLAYLIST['@ENTRIES']).toBe('1');
  });

  it('starts with an XML declaration', () => {
    const xml = buildNmlPlaylist('X', [makeEntry('A', 'B', 'c.mp3')]);
    expect(xml.startsWith('<?xml')).toBe(true);
  });
});

describe('writeNmlPlaylist', () => {
  it('creates the file and returns its path', async () => {
    const path = await writeNmlPlaylist('My Playlist', [makeEntry('A', 'B', 'a.mp3')], tmpDir);
    expect(path).not.toBeNull();
    expect(path!.endsWith('My Playlist.nml')).toBe(true);
    const onDisk = await readFile(path!, 'utf-8');
    expect(onDisk).toContain('<COLLECTION');
  });

  it('does not overwrite an existing file — appends ( n ) suffix', async () => {
    const tracks = [makeEntry('A', 'X', 'a.mp3')];
    const first = await writeNmlPlaylist('Dup', tracks, tmpDir);
    const second = await writeNmlPlaylist('Dup', tracks, tmpDir);
    const third = await writeNmlPlaylist('Dup', tracks, tmpDir);
    expect(first!.endsWith('Dup.nml')).toBe(true);
    expect(second!.endsWith('Dup (1).nml')).toBe(true);
    expect(third!.endsWith('Dup (2).nml')).toBe(true);
  });

  it('sanitizes illegal chars in the on-disk filename', async () => {
    const tracks = [makeEntry('A', 'X', 'a.mp3')];
    const path = await writeNmlPlaylist('weird: name*?', tracks, tmpDir);
    const base = path!.split(/[\\/]/).pop()!;
    expect(base).not.toContain(':');
    expect(base).not.toContain('*');
    expect(base).not.toContain('?');
  });

  it('falls back to "playlist" when name is all illegal chars', async () => {
    const path = await writeNmlPlaylist('***', [makeEntry('A', 'X', 'a.mp3')], tmpDir);
    const base = path!.split(/[\\/]/).pop()!;
    expect(base).toBe('playlist.nml');
  });

  it('returns null when the output directory is not writable', async () => {
    // Point at a file (not a directory) inside tmpDir so mkdir + writeFile both fail.
    const fakeDir = join(tmpDir, 'not-a-dir');
    await writeFile(fakeDir, 'busy', 'utf-8');
    const result = await writeNmlPlaylist('X', [makeEntry('A', 'B', 'c.mp3')], fakeDir);
    expect(result).toBeNull();
  });
});
