import { describe, expect, it } from 'vitest';

import type { GroupedResult } from './collectionSearch';
import type { NmlEntry } from './nml';
import {
  buildReviewGroups,
  collectSelectedEntries,
  deselectAll,
  selectAll,
  selectTopN,
  setCandidateSelected,
  summarize,
} from './review';

function entry(title: string, file: string): NmlEntry {
  return {
    '@TITLE': title,
    '@ARTIST': 'X',
    LOCATION: { '@DIR': '/:M/:', '@FILE': file, '@VOLUME': 'D:' },
  };
}

function makeGrouped(
  defs: { spotifyTitle: string; spotifyArtists: string; matches: { title: string; file: string; score: number }[] }[],
): Map<string, GroupedResult> {
  const out = new Map<string, GroupedResult>();
  for (const def of defs) {
    out.set(`${def.spotifyTitle}||${def.spotifyArtists}`, {
      spotify_track: { name: def.spotifyTitle, artists: [{ name: def.spotifyArtists }] },
      spotify_artists: def.spotifyArtists,
      collection_matches: def.matches.map((m) => ({ entry: entry(m.title, m.file), score: m.score })),
    });
  }
  return out;
}

describe('buildReviewGroups', () => {
  it('preserves Spotify-track insertion order and starts with nothing selected', () => {
    const grouped = makeGrouped([
      { spotifyTitle: 'A', spotifyArtists: 'X', matches: [{ title: 'a1', file: 'a.mp3', score: 90 }] },
      { spotifyTitle: 'B', spotifyArtists: 'Y', matches: [
        { title: 'b1', file: 'b.mp3', score: 80 },
        { title: 'b2', file: 'b2.mp3', score: 70 },
      ] },
    ]);
    const groups = buildReviewGroups(grouped);
    expect(groups.map((g) => g.spotifyTitle)).toEqual(['A', 'B']);
    expect(groups[0]?.selected).toEqual([false]);
    expect(groups[1]?.selected).toEqual([false, false]);
  });

  it('returns [] for an empty map', () => {
    expect(buildReviewGroups(new Map())).toEqual([]);
  });
});

describe('selectTopN', () => {
  it('selects the top N in every group, clearing first', () => {
    const groups = buildReviewGroups(
      makeGrouped([
        { spotifyTitle: 'A', spotifyArtists: 'X', matches: [
          { title: 'a1', file: 'a1.mp3', score: 95 },
          { title: 'a2', file: 'a2.mp3', score: 80 },
          { title: 'a3', file: 'a3.mp3', score: 70 },
        ] },
        { spotifyTitle: 'B', spotifyArtists: 'Y', matches: [
          { title: 'b1', file: 'b1.mp3', score: 90 },
        ] },
      ]),
    );
    // Manually select something so we can prove the cleared-first behavior.
    setCandidateSelected(groups[0]!, 2, true);

    selectTopN(groups, 2);
    expect(groups[0]?.selected).toEqual([true, true, false]);
    // Group B has only 1 candidate — Top 2 still selects what's there, no overflow.
    expect(groups[1]?.selected).toEqual([true]);
  });

  it('clamps n < 1 to 1 (mirrors Python max(1, int(n)))', () => {
    const groups = buildReviewGroups(
      makeGrouped([
        { spotifyTitle: 'A', spotifyArtists: 'X', matches: [
          { title: 'a1', file: 'a1.mp3', score: 95 },
          { title: 'a2', file: 'a2.mp3', score: 80 },
        ] },
      ]),
    );
    selectTopN(groups, 0);
    expect(groups[0]?.selected).toEqual([true, false]);
    selectTopN(groups, -5);
    expect(groups[0]?.selected).toEqual([true, false]);
  });

  it('treats non-finite n as 1', () => {
    const groups = buildReviewGroups(
      makeGrouped([
        { spotifyTitle: 'A', spotifyArtists: 'X', matches: [
          { title: 'a1', file: 'a1.mp3', score: 95 },
          { title: 'a2', file: 'a2.mp3', score: 80 },
        ] },
      ]),
    );
    selectTopN(groups, Number.NaN);
    expect(groups[0]?.selected).toEqual([true, false]);
  });
});

describe('selectAll / deselectAll', () => {
  it('selects every candidate in every group', () => {
    const groups = buildReviewGroups(
      makeGrouped([
        { spotifyTitle: 'A', spotifyArtists: 'X', matches: [
          { title: 'a1', file: 'a1.mp3', score: 95 },
          { title: 'a2', file: 'a2.mp3', score: 80 },
        ] },
      ]),
    );
    selectAll(groups);
    expect(groups[0]?.selected).toEqual([true, true]);
    deselectAll(groups);
    expect(groups[0]?.selected).toEqual([false, false]);
  });
});

describe('setCandidateSelected', () => {
  it('toggles a single candidate', () => {
    const groups = buildReviewGroups(
      makeGrouped([
        { spotifyTitle: 'A', spotifyArtists: 'X', matches: [
          { title: 'a1', file: 'a1.mp3', score: 95 },
          { title: 'a2', file: 'a2.mp3', score: 80 },
        ] },
      ]),
    );
    setCandidateSelected(groups[0]!, 1, true);
    expect(groups[0]?.selected).toEqual([false, true]);
    setCandidateSelected(groups[0]!, 1, false);
    expect(groups[0]?.selected).toEqual([false, false]);
  });

  it('ignores out-of-range indices', () => {
    const groups = buildReviewGroups(
      makeGrouped([
        { spotifyTitle: 'A', spotifyArtists: 'X', matches: [
          { title: 'a1', file: 'a1.mp3', score: 95 },
        ] },
      ]),
    );
    expect(() => setCandidateSelected(groups[0]!, 5, true)).not.toThrow();
    expect(() => setCandidateSelected(groups[0]!, -1, true)).not.toThrow();
    expect(groups[0]?.selected).toEqual([false]);
  });
});

describe('collectSelectedEntries', () => {
  it('returns entries in group-then-score order', () => {
    const groups = buildReviewGroups(
      makeGrouped([
        { spotifyTitle: 'A', spotifyArtists: 'X', matches: [
          { title: 'a1', file: 'a1.mp3', score: 95 },
          { title: 'a2', file: 'a2.mp3', score: 80 },
        ] },
        { spotifyTitle: 'B', spotifyArtists: 'Y', matches: [
          { title: 'b1', file: 'b1.mp3', score: 70 },
        ] },
      ]),
    );
    selectAll(groups);
    const out = collectSelectedEntries(groups);
    expect(out.map((e) => e.LOCATION['@FILE'])).toEqual(['a1.mp3', 'a2.mp3', 'b1.mp3']);
  });

  it('preserves duplicates across groups (mirrors Python writer)', () => {
    const shared = entry('shared', 'shared.mp3');
    const groups: ReturnType<typeof buildReviewGroups> = [
      { spotifyKey: 'A||X', spotifyArtists: 'X', spotifyTitle: 'A',
        candidates: [{ entry: shared, score: 90 }], selected: [true] },
      { spotifyKey: 'B||Y', spotifyArtists: 'Y', spotifyTitle: 'B',
        candidates: [{ entry: shared, score: 85 }], selected: [true] },
    ];
    const out = collectSelectedEntries(groups);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(out[1]);
  });

  it('returns [] when nothing is selected', () => {
    const groups = buildReviewGroups(
      makeGrouped([
        { spotifyTitle: 'A', spotifyArtists: 'X', matches: [
          { title: 'a1', file: 'a1.mp3', score: 95 },
        ] },
      ]),
    );
    expect(collectSelectedEntries(groups)).toEqual([]);
  });
});

describe('summarize', () => {
  it('counts groups, candidates, and selected', () => {
    const groups = buildReviewGroups(
      makeGrouped([
        { spotifyTitle: 'A', spotifyArtists: 'X', matches: [
          { title: 'a1', file: 'a1.mp3', score: 95 },
          { title: 'a2', file: 'a2.mp3', score: 80 },
        ] },
        { spotifyTitle: 'B', spotifyArtists: 'Y', matches: [
          { title: 'b1', file: 'b1.mp3', score: 70 },
        ] },
      ]),
    );
    selectTopN(groups, 1);
    expect(summarize(groups)).toEqual({ groups: 2, candidates: 3, selected: 2 });
  });
});
