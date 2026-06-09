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
  it('matches the Python set', () => {
    expect([...AUDIO_EXTENSIONS].sort()).toEqual(
      ['.mp3', '.m4a', '.flac', '.wav', '.aiff', '.aif', '.ogg', '.wma', '.alac', '.opus'].sort(),
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

  it('includes substring containment hits even when score is below threshold', () => {
    const idx = buildFileIndex([
      { rootPrefix: ROOT, relativeDir: '', filename: 'short.mp3', parsedName: 'short' },
    ]);
    // The track string fully contains the parsed name, so we keep it even
    // though the ratio against this very long track is low.
    const got = fuzzyMatchFiles(['short ride home with extra padding text'], idx, 95);
    expect(got.get('short ride home with extra padding text')).toBeDefined();
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
});
