import { describe, expect, it } from 'vitest';

import {
  AUDIO_EXTENSIONS,
  buildFileIndex,
  collectAudioFilesFromHandle,
  diskMatchToEntry,
  fuzzyMatchFiles,
  locationFromRelativePath,
  parseFilename,
  scanFileList,
  type DiskFile,
  type ScannableFile,
  type WalkableDirectoryHandle,
  type WalkableFileHandle,
} from './diskSearch';

describe('AUDIO_EXTENSIONS', () => {
  it('covers the Python audio set plus Traktor STEM / MP4 audio containers', () => {
    expect([...AUDIO_EXTENSIONS].sort()).toEqual(
      [
        '.mp3', '.m4a', '.flac', '.wav', '.aiff', '.aif',
        '.ogg', '.wma', '.alac', '.opus',
        '.mp4', '.stem.mp4',
      ].sort(),
    );
  });
});

describe('parseFilename', () => {
  it('strips extension', () => {
    expect(parseFilename('song.mp3')).toBe('song');
    expect(parseFilename('song.FLAC')).toBe('song');
  });
  it('strips leading track numbers in common formats', () => {
    expect(parseFilename('01 song.mp3')).toBe('song');
    expect(parseFilename('01. song.mp3')).toBe('song');
    expect(parseFilename('01 - song.mp3')).toBe('song');
    expect(parseFilename('1-song.mp3')).toBe('song');
    expect(parseFilename('123  song.mp3')).toBe('song');
  });
  it('preserves digits inside the name', () => {
    expect(parseFilename('Take 5.mp3')).toBe('Take 5');
    expect(parseFilename('1999_song.mp3')).toBe('1999 song');
  });
  it('replaces underscores and collapses whitespace', () => {
    expect(parseFilename('artist__title.mp3')).toBe('artist title');
    expect(parseFilename('  spaced   out  .mp3')).toBe('spaced out');
  });
  it('keeps files with no extension', () => {
    expect(parseFilename('no_extension')).toBe('no extension');
  });
  it('strips the full .stem.mp4 compound extension', () => {
    // Display name must not be left with a dangling ".stem" tail, otherwise
    // every STEM file would look like "<title> stem" to the fuzzy matcher.
    expect(parseFilename('daft punk - around the world.stem.mp4')).toBe(
      'daft punk - around the world',
    );
    expect(parseFilename('01 song.STEM.MP4')).toBe('song');
  });
});

describe('scanFileList', () => {
  function file(webkitRelativePath: string): ScannableFile {
    const slash = webkitRelativePath.lastIndexOf('/');
    return {
      name: slash >= 0 ? webkitRelativePath.slice(slash + 1) : webkitRelativePath,
      webkitRelativePath,
    };
  }

  it('filters by audio extension (case insensitive) and strips the picked-folder prefix', () => {
    const got = scanFileList(
      [
        file('Library/genre/01 song.mp3'),
        file('Library/genre/notes.txt'),
        file('Library/cover.JPG'),
        file('Library/album/song.FLAC'),
        file('Library/song.wav'),
      ],
      'D:\\Music\\Library',
    );
    expect(got).toEqual<DiskFile[]>([
      { rootPrefix: 'D:\\Music\\Library', relativeDir: 'genre', filename: '01 song.mp3', parsedName: 'song' },
      { rootPrefix: 'D:\\Music\\Library', relativeDir: 'album', filename: 'song.FLAC', parsedName: 'song' },
      { rootPrefix: 'D:\\Music\\Library', relativeDir: '', filename: 'song.wav', parsedName: 'song' },
    ]);
  });

  it('returns [] when nothing matches', () => {
    expect(scanFileList([file('Library/readme.txt')], 'D:\\Music\\Library')).toEqual([]);
  });

  it('indexes Traktor STEM files (.stem.mp4 and bare .mp4/.m4a variants)', () => {
    // STEM exports show up under three names in the wild: the official
    // compound ".stem.mp4", a renamed bare ".mp4", and ".m4a" when the
    // user has stripped the extension or re-muxed. All should be indexed
    // so the fuzzy match can find them.
    const got = scanFileList(
      [
        file('Library/stems/daft punk - around the world.stem.mp4'),
        file('Library/stems/queen - bohemian rhapsody.mp4'),
        file('Library/stems/abba - dancing queen.m4a'),
        file('Library/photos/cover.jpg'),
      ],
      'D:\\Music\\Library',
    );
    expect(got.map((f) => f.filename).sort()).toEqual([
      'abba - dancing queen.m4a',
      'daft punk - around the world.stem.mp4',
      'queen - bohemian rhapsody.mp4',
    ]);
    // Display names are clean — no leftover ".stem" or extension tail.
    const byFile = new Map(got.map((f) => [f.filename, f.parsedName]));
    expect(byFile.get('daft punk - around the world.stem.mp4')).toBe(
      'daft punk - around the world',
    );
    expect(byFile.get('queen - bohemian rhapsody.mp4')).toBe('queen - bohemian rhapsody');
    expect(byFile.get('abba - dancing queen.m4a')).toBe('abba - dancing queen');
  });
});

describe('buildFileIndex + fuzzyMatchFiles', () => {
  const ROOT = 'D:\\Music';
  const files: DiskFile[] = [
    { rootPrefix: ROOT, relativeDir: 'house', filename: 'daft punk - around the world.mp3', parsedName: 'daft punk - around the world' },
    { rootPrefix: ROOT, relativeDir: 'house', filename: 'daft punk - one more time.mp3', parsedName: 'daft punk - one more time' },
    { rootPrefix: ROOT, relativeDir: 'rock', filename: 'queen - bohemian rhapsody.mp3', parsedName: 'queen - bohemian rhapsody' },
    { rootPrefix: ROOT, relativeDir: '', filename: 'unrelated.wav', parsedName: 'unrelated' },
  ];

  it('returns disk matches sorted descending by score, only for tracks with matches', () => {
    const idx = buildFileIndex(files);
    const got = fuzzyMatchFiles(
      ['Daft Punk - Around the World', 'Queen - Bohemian Rhapsody', 'Nonexistent - Nothing'],
      idx,
      70,
    );
    expect([...got.keys()]).toEqual([
      'Daft Punk - Around the World',
      'Queen - Bohemian Rhapsody',
    ]);
    const daftMatches = got.get('Daft Punk - Around the World')!;
    expect(daftMatches[0]?.file.filename).toBe('daft punk - around the world.mp3');
    expect(daftMatches[0]?.score).toBeGreaterThanOrEqual(daftMatches[1]?.score ?? -1);
  });

  it('respects the score threshold strictly — no low-score substring-containment hits', () => {
    const idx = buildFileIndex([
      { rootPrefix: ROOT, relativeDir: '', filename: 'short.mp3', parsedName: 'short' },
    ]);
    // The track string fully contains the parsed name, but the fuzz.ratio
    // against the long padded string is far below 95, so we no longer
    // surface it. Previously a substring-containment OR clause would let
    // it through with a misleading score in the teens.
    const got = fuzzyMatchFiles(['short ride home with extra padding text'], idx, 95);
    expect(got.get('short ride home with extra padding text')).toBeUndefined();
  });

  it('fires the progress callback once per track and swallows callback errors', () => {
    const idx = buildFileIndex(files);
    const calls: Array<[number, number]> = [];
    fuzzyMatchFiles(['a', 'b', 'c'], idx, 70, (done, total) => {
      calls.push([done, total]);
      if (done === 2) throw new Error('boom');
    });
    expect(calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('uses ID3/MP4 tags when present, scoring artist and title separately', () => {
    // The filename is a noisy "DJ rip" form that wouldn't match the
    // Spotify query on its own (low ratio against the long, padded
    // filename). With tags supplied, the matcher scores
    // queryArtist ↔ tagArtist and queryTitle ↔ tagTitle, averaged.
    const idx = buildFileIndex([
      {
        rootPrefix: ROOT,
        relativeDir: 'rips',
        filename: '01 - dj snake mix - track id - id - 128bpm.mp3',
        parsedName: '- dj snake mix - track id - id - 128bpm',
        tags: { artist: 'Daft Punk', title: 'One More Time' },
      },
    ]);
    const got = fuzzyMatchFiles(['Daft Punk - One More Time'], idx, 90);
    const matches = got.get('Daft Punk - One More Time');
    expect(matches).toBeDefined();
    expect(matches!.length).toBe(1);
    expect(matches![0]!.score).toBeGreaterThanOrEqual(90);
  });

  it('falls back to filename scoring when a candidate has no tags', () => {
    const idx = buildFileIndex([
      {
        rootPrefix: ROOT,
        relativeDir: '',
        filename: 'daft punk - one more time.mp3',
        parsedName: 'daft punk - one more time',
        // No tags.
      },
    ]);
    const got = fuzzyMatchFiles(['Daft Punk - One More Time'], idx, 70);
    expect(got.get('Daft Punk - One More Time')).toBeDefined();
  });

  it('indexes tag tokens so tag-only matches survive the prefilter', () => {
    // The filename and parsedName share no token with the search query,
    // so without tag-token indexing the prefilter would drop this file.
    const idx = buildFileIndex([
      {
        rootPrefix: ROOT,
        relativeDir: '',
        filename: 'track-001.mp3',
        parsedName: 'track-001',
        tags: { artist: 'Queen', title: 'Bohemian Rhapsody' },
      },
    ]);
    const got = fuzzyMatchFiles(['Queen - Bohemian Rhapsody'], idx, 90);
    expect(got.get('Queen - Bohemian Rhapsody')).toBeDefined();
  });
});

describe('collectAudioFilesFromHandle tag enrichment', () => {
  it('invokes the readTags callback for each audio file and attaches returned tags', async () => {
    type Walk = WalkableDirectoryHandle;
    const stubFile = (name: string): WalkableFileHandle => ({
      kind: 'file',
      name,
      getFile: async () =>
        new File([new Uint8Array([0])], name, { type: 'audio/mpeg' }),
    });
    const root: Walk = {
      kind: 'directory',
      name: 'root',
      values: async function* () {
        yield stubFile('a.mp3');
        yield stubFile('b.flac');
        yield { kind: 'file', name: 'notes.txt' } as WalkableFileHandle; // non-audio, skipped
      },
    };
    const seenNames: string[] = [];
    const readTags = async (f: File) => {
      seenNames.push(f.name);
      return { artist: 'A', title: f.name };
    };
    const out = await collectAudioFilesFromHandle(root, 'D:\\Music', undefined, {
      readTags,
    });
    expect(out.map((f) => f.filename).sort()).toEqual(['a.mp3', 'b.flac']);
    expect(seenNames.sort()).toEqual(['a.mp3', 'b.flac']);
    expect(out.every((f) => f.tags?.artist === 'A')).toBe(true);
  });

  it('skips tag-reading entirely when no readTags is provided (zero extra work)', async () => {
    let getFileCalls = 0;
    const root: WalkableDirectoryHandle = {
      kind: 'directory',
      name: 'root',
      values: async function* () {
        yield {
          kind: 'file',
          name: 'a.mp3',
          getFile: async () => {
            getFileCalls += 1;
            return new File([new Uint8Array([0])], 'a.mp3');
          },
        };
      },
    };
    const out = await collectAudioFilesFromHandle(root, 'D:\\Music');
    expect(out.length).toBe(1);
    expect(out[0]!.tags).toBeUndefined();
    expect(getFileCalls).toBe(0);
  });
});

describe('locationFromRelativePath', () => {
  it('builds a Traktor location for nested Windows paths', () => {
    expect(locationFromRelativePath('D:\\Music\\Library', 'genre/artist', 'song.mp3')).toEqual({
      '@VOLUME': 'D:',
      '@DIR': '/:Music/:Library/:genre/:artist/:',
      '@FILE': 'song.mp3',
    });
  });

  it('accepts forward-slash root prefix', () => {
    expect(locationFromRelativePath('D:/Music', '', 'song.mp3')).toEqual({
      '@VOLUME': 'D:',
      '@DIR': '/:Music/:',
      '@FILE': 'song.mp3',
    });
  });

  it('handles drive-letter-only root', () => {
    expect(locationFromRelativePath('D:', '', 'song.mp3')).toEqual({
      '@VOLUME': 'D:',
      '@DIR': '/:',
      '@FILE': 'song.mp3',
    });
  });

  it('returns empty volume for paths without a drive letter', () => {
    expect(locationFromRelativePath('/Users/dj/Music', 'house', 'song.mp3')).toEqual({
      '@VOLUME': '',
      '@DIR': '/:Users/:dj/:Music/:house/:',
      '@FILE': 'song.mp3',
    });
  });
});

describe('diskMatchToEntry', () => {
  const file: DiskFile = {
    rootPrefix: 'D:\\Music',
    relativeDir: 'house',
    filename: 'song.mp3',
    parsedName: 'song',
  };

  it('splits "Artist - Title" into separate fields and pulls the prefix from the file', () => {
    const entry = diskMatchToEntry(file, 'Daft Punk - Around the World');
    expect(entry['@ARTIST']).toBe('Daft Punk');
    expect(entry['@TITLE']).toBe('Around the World');
    expect(entry.LOCATION).toEqual({
      '@VOLUME': 'D:',
      '@DIR': '/:Music/:house/:',
      '@FILE': 'song.mp3',
    });
  });

  it('falls back to title-only when there is no " - " separator', () => {
    const entry = diskMatchToEntry(file, 'Standalone Title');
    expect(entry['@ARTIST']).toBe('');
    expect(entry['@TITLE']).toBe('Standalone Title');
  });

  it('uses the per-file rootPrefix so a combined index can span sources', () => {
    const altFile: DiskFile = {
      rootPrefix: 'E:\\Promos',
      relativeDir: '2026',
      filename: 'song.mp3',
      parsedName: 'song',
    };
    const entry = diskMatchToEntry(altFile, 'X - Y');
    expect(entry.LOCATION).toEqual({
      '@VOLUME': 'E:',
      '@DIR': '/:Promos/:2026/:',
      '@FILE': 'song.mp3',
    });
  });
});

describe('collectAudioFilesFromHandle', () => {
  // Hand-rolled fakes that satisfy the minimal structural contract.
  function file(name: string): WalkableFileHandle {
    return { kind: 'file', name };
  }
  function dir(
    name: string,
    children: (WalkableDirectoryHandle | WalkableFileHandle)[],
  ): WalkableDirectoryHandle {
    return {
      kind: 'directory',
      name,
      async *values() {
        for (const child of children) yield child;
      },
    };
  }

  it('walks recursively, filters by AUDIO_EXTENSIONS, and reports relative dirs', async () => {
    const root = dir('Library', [
      file('top.mp3'),
      file('cover.jpg'), // non-audio, skipped
      dir('House', [
        file('01 track-a.flac'),
        dir('Deep', [file('track-b.wav')]),
      ]),
      dir('Empty', []),
    ]);

    const result = await collectAudioFilesFromHandle(root, 'D:\\Music\\Library');
    const summary = result
      .map((f) => `${f.relativeDir}|${f.filename}`)
      .sort();
    expect(summary).toEqual(
      [
        '|top.mp3',
        'House|01 track-a.flac',
        'House/Deep|track-b.wav',
      ].sort(),
    );
    // Every file is stamped with the supplied root prefix.
    expect(result.every((f) => f.rootPrefix === 'D:\\Music\\Library')).toBe(true);
  });

  it('does not include the root folder name in relativeDir (matches scanFileList)', async () => {
    const root = dir('Music', [file('only.mp3')]);
    const result = await collectAudioFilesFromHandle(root, 'D:\\Music');
    expect(result).toHaveLength(1);
    expect(result[0]!.relativeDir).toBe('');
  });

  it('invokes onProgress with the running count and a final tally', async () => {
    // 600 audio files in one folder so the every-500 progress tick fires.
    const children = Array.from({ length: 600 }, (_, i) => file(`t${i}.mp3`));
    const root = dir('Big', children);
    const counts: number[] = [];
    await collectAudioFilesFromHandle(root, 'D:\\Music', (n) => counts.push(n));
    expect(counts[counts.length - 1]).toBe(600);
    expect(counts).toContain(500);
  });

  it('picks up Traktor STEM files during the recursive walk', async () => {
    const root = dir('Library', [
      file('regular.mp3'),
      dir('Stems', [
        file('queen - bohemian rhapsody.stem.mp4'),
        file('cover-art.jpg'),
      ]),
    ]);
    const result = await collectAudioFilesFromHandle(root, 'D:\\Music\\Library');
    const filenames = result.map((f) => f.filename).sort();
    expect(filenames).toEqual(['queen - bohemian rhapsody.stem.mp4', 'regular.mp3'].sort());
    const stem = result.find((f) => f.filename.endsWith('.stem.mp4'))!;
    expect(stem.parsedName).toBe('queen - bohemian rhapsody');
    expect(stem.relativeDir).toBe('Stems');
  });
});
