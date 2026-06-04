import { describe, expect, it } from 'vitest';

import {
  buildCollectionIndex,
  fuzzySearch,
  type Playlist,
} from './collectionSearch';
import type { NmlEntry } from './nml';

function sampleCollection(): NmlEntry[] {
  return [
    {
      '@TITLE': 'Mixed Bizness',
      '@ARTIST': 'Beck',
      LOCATION: { '@DIR': '/:Music/:', '@FILE': '03 Mixed Bizness.mp3', '@VOLUME': 'D:' },
    },
    {
      '@TITLE': 'Crazy In Love',
      '@ARTIST': 'Beyoncé',
      LOCATION: { '@DIR': '/:Music/:', '@FILE': '01 Crazy In Love.m4a', '@VOLUME': 'D:' },
    },
    {
      '@TITLE': 'Gut Feeling',
      '@ARTIST': 'Devo',
      LOCATION: { '@DIR': '/:Music/:', '@FILE': '13 Gut Feeling.mp3', '@VOLUME': 'D:' },
    },
    {
      '@TITLE': 'Crazy',
      '@ARTIST': 'Gnarls Barkley',
      LOCATION: { '@DIR': '/:Music/:', '@FILE': '01 Crazy.mp3', '@VOLUME': 'D:' },
    },
  ];
}

function makePlaylist(pairs: [string, string][]): Playlist {
  return {
    items: pairs.map(([title, artist]) => ({
      track: { name: title, artists: [{ name: artist }] },
    })),
  };
}

describe('buildCollectionIndex', () => {
  it('maps title tokens to entry indices', () => {
    const { titleIndex, artistIndex } = buildCollectionIndex(sampleCollection());
    // 'crazy' should be in entries 1 (Crazy In Love) and 3 (Crazy)
    expect(titleIndex.get('crazy')?.has(1)).toBe(true);
    expect(titleIndex.get('crazy')?.has(3)).toBe(true);
    // 'beck' should map to entry 0
    expect(artistIndex.get('beck')?.has(0)).toBe(true);
  });

  it('handles an empty collection', () => {
    const { titleIndex, artistIndex } = buildCollectionIndex([]);
    expect(titleIndex.size).toBe(0);
    expect(artistIndex.size).toBe(0);
  });
});

describe('fuzzySearch', () => {
  it('finds an exact match using the index', () => {
    const collection = sampleCollection();
    const playlist = makePlaylist([['Crazy In Love', 'Beyoncé']]);
    const { titleIndex, artistIndex } = buildCollectionIndex(collection);

    const { groupedResults, notFoundTracks } = fuzzySearch(playlist, collection, 70, {
      titleIndex,
      artistIndex,
    });

    expect(notFoundTracks).toHaveLength(0);
    expect(groupedResults.size).toBe(1);
    const match = [...groupedResults.values()][0]!;
    expect(match.collection_matches[0]?.entry['@TITLE']).toBe('Crazy In Love');
    expect(match.collection_matches[0]?.score).toBeGreaterThanOrEqual(70);
  });

  it('reports unmatched tracks in not-found', () => {
    const collection = sampleCollection();
    const playlist = makePlaylist([['Nonexistent Song', 'Nobody']]);
    const { titleIndex, artistIndex } = buildCollectionIndex(collection);

    const { groupedResults, notFoundTracks } = fuzzySearch(playlist, collection, 70, {
      titleIndex,
      artistIndex,
    });

    expect(groupedResults.size).toBe(0);
    expect(notFoundTracks).toHaveLength(1);
  });

  it('matches fuzzy variants at a lower threshold', () => {
    const collection = sampleCollection();
    const playlist = makePlaylist([['Crazy in Luv', 'Beyoncé']]);
    const { titleIndex, artistIndex } = buildCollectionIndex(collection);

    const { groupedResults } = fuzzySearch(playlist, collection, 50, {
      titleIndex,
      artistIndex,
    });

    expect(groupedResults.size).toBeGreaterThanOrEqual(1);
  });

  it('falls back to a full scan when no indexes are provided', () => {
    const collection = sampleCollection();
    const playlist = makePlaylist([['Mixed Bizness', 'Beck']]);

    const { groupedResults, notFoundTracks } = fuzzySearch(playlist, collection, 70);

    expect(groupedResults.size).toBe(1);
    expect(notFoundTracks).toHaveLength(0);
  });

  it('does not crash on entries missing @ARTIST', () => {
    const collection: NmlEntry[] = [
      {
        '@TITLE': 'Mystery Track',
        LOCATION: { '@DIR': '/:Music/:', '@FILE': 'mystery.mp3', '@VOLUME': 'D:' },
      },
    ];
    const playlist = makePlaylist([['Mystery Track', 'Someone']]);

    const result = fuzzySearch(playlist, collection, 70);
    expect(result.groupedResults).toBeInstanceOf(Map);
    expect(Array.isArray(result.notFoundTracks)).toBe(true);
  });

  it('emits "Artist - Title" for not-found tracks (no prefix)', () => {
    const playlist = makePlaylist([['Imaginary Track', 'Imaginary Artist']]);
    const { notFoundTracks } = fuzzySearch(playlist, sampleCollection(), 70);
    expect(notFoundTracks).toEqual(['Imaginary Artist - Imaginary Track']);
    expect(notFoundTracks[0]?.toLowerCase().startsWith('track not found')).toBe(false);
  });

  it('invokes progressCallback once per playlist track with (done, total)', () => {
    const playlist = makePlaylist([
      ['Crazy In Love', 'Beyoncé'],
      ['Nope', 'Nobody'],
      ['Mixed Bizness', 'Beck'],
    ]);
    const calls: [number, number][] = [];
    fuzzySearch(playlist, sampleCollection(), 70, {
      progressCallback: (done, total) => calls.push([done, total]),
    });
    expect(calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('swallows errors thrown from progressCallback', () => {
    const playlist = makePlaylist([['Crazy In Love', 'Beyoncé']]);
    const boom = () => {
      throw new Error('UI thread is grumpy');
    };
    expect(() =>
      fuzzySearch(playlist, sampleCollection(), 70, { progressCallback: boom }),
    ).not.toThrow();
  });
});
