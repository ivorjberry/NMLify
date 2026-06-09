/**
 * Thin wrapper around music-metadata's parseBlob — kept in its own module
 * so diskSearch.ts stays free of the dependency and remains trivially
 * unit-testable without pulling in the parser.
 *
 * We deliberately ask the parser to skip cover art and duration to keep
 * the per-file cost as low as possible: artwork can be tens of MB on
 * lossless files, and we never display it. Only artist/title/album are
 * surfaced to the matcher and the UI.
 */
import { parseBlob } from 'music-metadata';
import type { DiskFileTags, TagReader } from './diskSearch';

export const readTagsFromBlob: TagReader = async (file) => {
  try {
    const meta = await parseBlob(file, {
      duration: false,
      skipCovers: true,
      // skipPostHeaders trims the parser's work after the tag block —
      // safe for us because we only ever read common.* fields.
      skipPostHeaders: true,
    });
    const c = meta.common;
    const tags: DiskFileTags = {};
    if (c.artist) {
      tags.artist = c.artist;
    } else if (c.artists && c.artists.length > 0) {
      tags.artist = c.artists.join(', ');
    }
    if (c.title) tags.title = c.title;
    if (c.album) tags.album = c.album;
    return tags.artist || tags.title || tags.album ? tags : undefined;
  } catch {
    // Per-file parse failures are non-fatal. The caller will fall back
    // to the parsed-filename match for this file.
    return undefined;
  }
};
