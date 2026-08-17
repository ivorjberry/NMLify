/**
 * Pure review-state helpers — mirrors the selection semantics in
 * desktop/crate.py (`select_top_n`, `select_all`, `select_first_matches`,
 * `deselect_all`, and per-candidate toggling). Kept DOM-free so we can unit
 * test it and so main.ts can swap in a different renderer later.
 */
import type { CollectionMatch, GroupedResult } from './collectionSearch';
import type { NmlEntry } from './nml';

export interface ReviewGroup {
  spotifyKey: string;
  spotifyArtists: string;
  spotifyTitle: string;
  /** Sorted for display; initially descending by score from {@link fuzzySearch}. */
  candidates: CollectionMatch[];
  /** Parallel to `candidates`; `true` means include in the crate. */
  selected: boolean[];
}

export interface ReviewSummary {
  groups: number;
  candidates: number;
  selected: number;
}

/**
 * Build review state from {@link fuzzySearch}'s `groupedResults`. Map iteration
 * order is preserved, so the UI lists tracks in the playlist's original order.
 * Every group starts with no candidates selected — the caller chooses an
 * initial bulk selection (typically `selectTopN(groups, 1)`).
 */
export function buildReviewGroups(groupedResults: Map<string, GroupedResult>): ReviewGroup[] {
  const out: ReviewGroup[] = [];
  for (const [spotifyKey, group] of groupedResults) {
    out.push({
      spotifyKey,
      spotifyArtists: group.spotify_artists,
      spotifyTitle: group.spotify_track.name,
      candidates: group.collection_matches,
      selected: group.collection_matches.map(() => false),
    });
  }
  return out;
}

/**
 * Put preferred candidates first, then sort each tier by descending match
 * score. Selection follows its candidate when an existing review is reordered.
 */
export function prioritizeCandidates(
  groups: ReviewGroup[],
  isPreferred: (candidate: CollectionMatch) => boolean,
): void {
  for (const group of groups) {
    const rows = group.candidates.map((candidate, index) => ({
      candidate,
      selected: group.selected[index] === true,
      originalIndex: index,
      preferred: isPreferred(candidate),
    }));
    rows.sort(
      (a, b) =>
        Number(b.preferred) - Number(a.preferred) ||
        b.candidate.score - a.candidate.score ||
        a.originalIndex - b.originalIndex,
    );
    group.candidates = rows.map((row) => row.candidate);
    group.selected = rows.map((row) => row.selected);
  }
}

/**
 * Select the top `n` candidates in every group (everything else cleared).
 * `n` is clamped to at least 1, mirroring the Python `max(1, int(n))`.
 * Groups with fewer than `n` candidates simply select all of them.
 */
export function selectTopN(groups: ReviewGroup[], n: number): void {
  const safeN = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  for (const g of groups) {
    for (let i = 0; i < g.candidates.length; i += 1) {
      g.selected[i] = i < safeN;
    }
  }
}

/** Select every candidate in every group. */
export function selectAll(groups: ReviewGroup[]): void {
  for (const g of groups) {
    for (let i = 0; i < g.candidates.length; i += 1) {
      g.selected[i] = true;
    }
  }
}

/** Clear every selection. */
export function deselectAll(groups: ReviewGroup[]): void {
  for (const g of groups) {
    for (let i = 0; i < g.candidates.length; i += 1) {
      g.selected[i] = false;
    }
  }
}

/**
 * Toggle a single candidate. Out-of-range indices are silently ignored so the
 * caller doesn't have to guard against stale DOM events.
 */
export function setCandidateSelected(
  group: ReviewGroup,
  candidateIndex: number,
  checked: boolean,
): void {
  if (candidateIndex < 0 || candidateIndex >= group.candidates.length) return;
  group.selected[candidateIndex] = checked;
}

/**
 * Flatten the selection into the ordered list of `NmlEntry` to include in the
 * crate. Order: groups in iteration order, then candidates in score order.
 * Duplicates are preserved (mirrors the Python writer — the same collection
 * track matched against two different Spotify tracks lands in the crate twice).
 */
export function collectSelectedEntries(groups: ReviewGroup[]): NmlEntry[] {
  const out: NmlEntry[] = [];
  for (const g of groups) {
    for (let i = 0; i < g.candidates.length; i += 1) {
      if (g.selected[i]) {
        const match = g.candidates[i];
        if (match) out.push(match.entry);
      }
    }
  }
  return out;
}

/** Counts for the UI header. */
export function summarize(groups: ReviewGroup[]): ReviewSummary {
  let candidates = 0;
  let selected = 0;
  for (const g of groups) {
    candidates += g.candidates.length;
    for (const s of g.selected) if (s) selected += 1;
  }
  return { groups: groups.length, candidates, selected };
}
