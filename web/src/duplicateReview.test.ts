import { describe, expect, it } from 'vitest';

import type { NmlEntry } from './nml';
import {
  findDuplicateReviewGroups,
  formatDuplicateReviewReport,
} from './duplicateReview';

function entry(
  artist: string,
  title: string,
  file: string,
  duration: number,
  bitrate = 320000,
  overrides: Partial<NmlEntry> = {},
): NmlEntry {
  return {
    '@ARTIST': artist,
    '@TITLE': title,
    LOCATION: { '@VOLUME': 'D:', '@DIR': '/:Music/:', '@FILE': file },
    INFO: {
      '@PLAYTIME_FLOAT': String(duration),
      '@BITRATE': String(bitrate),
      '@FILESIZE': '5000',
    },
    ...overrides,
  };
}

describe('findDuplicateReviewGroups', () => {
  it('groups the same song at different bitrates', () => {
    const groups = findDuplicateReviewGroups([
      entry('Artist', 'Song', 'song-320.mp3', 200, 320000),
      entry('Artist', 'Song', 'song-128.mp3', 201, 128000),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.confidence).toBe('likely');
    expect(groups[0]!.entries.map((item) => item.bitrateKbps)).toEqual([128, 320]);
  });

  it('groups identical AUDIO_ID values with exact confidence', () => {
    const groups = findDuplicateReviewGroups([
      entry('Artist', 'Song One', 'one.mp3', 200, 320000, { '@AUDIO_ID': 'same' }),
      entry('Artist', 'Different title', 'two.mp3', 250, 320000, { '@AUDIO_ID': 'same' }),
    ]);
    expect(groups[0]).toMatchObject({
      confidence: 'exact',
      reasons: ['same AUDIO_ID'],
    });
  });

  it('does not combine materially different versions or durations', () => {
    expect(findDuplicateReviewGroups([
      entry('Artist', 'Song (Radio Edit)', 'radio.mp3', 180),
      entry('Artist', 'Song (Extended Mix)', 'extended.mp3', 300),
    ])).toEqual([]);
  });

  it('groups very similar titles when duration and version markers agree', () => {
    const groups = findDuplicateReviewGroups([
      entry('Artist', 'Great Song', 'one.mp3', 200),
      entry('Artist', 'Great Songs', 'two.mp3', 200.5),
    ]);
    expect(groups[0]!.confidence).toBe('possible');
  });

  it('formats metadata needed for manual review', () => {
    const groups = findDuplicateReviewGroups([
      entry('Artist', 'Song', 'one.mp3', 200),
      entry('Artist', 'Song', 'two.mp3', 200),
    ]);
    expect(formatDuplicateReviewReport(groups)).toContain('Bitrate: 320 kbps');
  });
});
