/**
 * Tests for the pure helpers exported from backups.ts. The IndexedDB
 * surface (saveBackup / listBackups / restoreBackup / deleteBackup) is
 * intentionally exercised manually in the browser — pulling in a fake
 * IDB just for these wrappers isn't worth the dep weight while the
 * surface is this thin.
 */
import { describe, expect, it } from 'vitest';

import {
  backupDownloadFilename,
  formatBytes,
  formatRelativeTime,
  MAX_BACKUPS,
  selectIdsToPrune,
  sha256Hex,
} from './backups';

describe('formatBytes', () => {
  it('renders small sizes in bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('promotes to KB / MB / GB with one decimal under 10', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10 * 1024)).toBe('10 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GB');
  });

  it('treats invalid input as zero', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('formatRelativeTime', () => {
  const NOW = 1_000_000_000_000;

  it('says "just now" within 10 seconds', () => {
    expect(formatRelativeTime(NOW - 0, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - 9_000, NOW)).toBe('just now');
  });

  it('renders seconds, minutes, hours, days', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('30s ago');
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3h ago');
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toBe('2d ago');
  });

  it('never returns negative deltas', () => {
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe('just now');
  });
});

describe('selectIdsToPrune', () => {
  it('returns nothing when under the cap', () => {
    const records = [
      { id: 1, timestamp: 100 },
      { id: 2, timestamp: 200 },
    ];
    expect(selectIdsToPrune(records, 5)).toEqual([]);
  });

  it('removes the oldest first when over the cap', () => {
    const records = [
      { id: 3, timestamp: 300 },
      { id: 1, timestamp: 100 },
      { id: 2, timestamp: 200 },
      { id: 4, timestamp: 400 },
    ];
    expect(selectIdsToPrune(records, 2)).toEqual([1, 2]);
  });

  it('defaults to MAX_BACKUPS', () => {
    const records = Array.from({ length: MAX_BACKUPS + 3 }, (_, i) => ({
      id: i + 1,
      timestamp: (i + 1) * 100,
    }));
    expect(selectIdsToPrune(records)).toEqual([1, 2, 3]);
  });
});

describe('backupDownloadFilename', () => {
  it('preserves the original base name and appends an ISO-ish timestamp', () => {
    const ts = Date.UTC(2026, 5, 9, 14, 30, 45, 123); // June 9 2026 14:30:45.123 UTC
    expect(backupDownloadFilename(ts, 'collection.nml')).toBe(
      'collection-backup-2026-06-09T14-30-45-123.nml',
    );
  });

  it('appends .nml when missing and sanitizes unsafe characters', () => {
    const ts = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
    expect(backupDownloadFilename(ts, 'weird:name?')).toBe(
      'weird_name_-backup-2026-01-01T00-00-00-000.nml',
    );
  });

  it('falls back to "collection" when the source name is unusable', () => {
    const ts = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
    expect(backupDownloadFilename(ts, '???')).toBe(
      'collection-backup-2026-01-01T00-00-00-000.nml',
    );
  });
});

describe('sha256Hex', () => {
  it('matches the canonical SHA-256 of the empty string', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the canonical SHA-256 of "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is deterministic', async () => {
    const a = await sha256Hex('hello world');
    const b = await sha256Hex('hello world');
    expect(a).toBe(b);
  });
});
