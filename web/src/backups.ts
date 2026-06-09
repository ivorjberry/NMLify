/**
 * NMLify — collection backup ring buffer.
 *
 * Whenever the user loads a collection.nml, we stash a gzipped copy in
 * IndexedDB keyed by content hash. The most recent `MAX_BACKUPS` snapshots
 * are kept; older ones are pruned automatically. The user can re-download
 * any snapshot as a .nml file from the Backups card and restore it
 * manually by replacing Traktor's working collection.nml.
 *
 * Rationale:
 *  - IndexedDB: works in every modern browser, large quota, survives tab
 *    close. localStorage is too small (5 MB) for raw XML collections.
 *  - gzip via CompressionStream: a typical collection.nml is 5–50 MB of
 *    XML which compresses ~8:1, so 10 snapshots fit comfortably.
 *  - SHA-256 dedupe: re-loading the same file shouldn't spam the list.
 *
 * All IndexedDB chatter is encapsulated here; the rest of the app talks
 * to this module through saveBackup / listBackups / restoreBackup /
 * deleteBackup. Pure helpers (formatBytes, formatRelativeTime,
 * selectIdsToPrune, sha256Hex, backupDownloadFilename) are exported so
 * they can be unit-tested without an IDB stub.
 */

export const MAX_BACKUPS = 10;
const DB_NAME = 'nmlify-backups';
const DB_VERSION = 1;
const STORE = 'backups';

export interface BackupMeta {
  id: number;
  /** Epoch ms when the snapshot was taken. */
  timestamp: number;
  /** Original filename the user loaded (e.g. "collection.nml"). */
  filename: string;
  /** Number of <ENTRY> elements at load time. */
  entryCount: number;
  /** Uncompressed XML size in bytes. */
  byteSize: number;
  /** SHA-256 hex digest of the uncompressed XML — used for dedupe. */
  hash: string;
}

interface BackupRecord extends BackupMeta {
  /** Gzipped XML payload. */
  blob: Blob;
}

export interface SaveResult {
  /** Id of the relevant record (existing on dedupe, new otherwise). */
  id: number;
  /** True if a fresh snapshot was inserted; false if dedupe skipped it. */
  created: boolean;
}

// ---------- Pure helpers (tested) ---------------------------------------

/** Human-readable byte size: 1500 → "1.5 KB", 1_500_000 → "1.4 MB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = units[0]!;
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i]!;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

/** "just now", "5m ago", "3h ago", "2d ago". `now` injectable for tests. */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diffSec = Math.max(0, Math.round((now - ts) / 1000));
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

/**
 * Given existing records and the allowed cap, return the ids of the
 * oldest records to delete so the count falls to at most `max`.
 */
export function selectIdsToPrune(
  records: Pick<BackupMeta, 'id' | 'timestamp'>[],
  max: number = MAX_BACKUPS,
): number[] {
  if (records.length <= max) return [];
  const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp);
  return sorted.slice(0, records.length - max).map(r => r.id);
}

/**
 * Filename used when the user downloads a snapshot. Preserves the
 * original base name so a backup of `collection.nml` becomes
 * `collection-backup-<iso>.nml` and is easy to identify on disk.
 */
export function backupDownloadFilename(timestamp: number, originalFilename: string): string {
  const iso = new Date(timestamp).toISOString().replace(/[:.]/g, '-').replace(/-?Z$/, '');
  const lower = originalFilename.toLowerCase();
  const base = lower.endsWith('.nml') ? originalFilename.slice(0, -4) : originalFilename;
  const sanitized = base.replace(/[\\/:*?"<>|]/g, '_');
  // Fall back when nothing alphanumeric is left — a string of underscores
  // would technically be a valid filename but tells the user nothing.
  const usable = /[A-Za-z0-9]/.test(sanitized) ? sanitized : 'collection';
  return `${usable}-backup-${iso}.nml`;
}

/** SHA-256 hex digest of a UTF-8 string, using SubtleCrypto. */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

// ---------- Compression -------------------------------------------------

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

async function gunzip(blob: Blob): Promise<string> {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

// ---------- IndexedDB wrapper -------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        os.createIndex('byTimestamp', 'timestamp');
        os.createIndex('byHash', 'hash', { unique: false });
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

function reqAsync<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** True if backups can be persisted in this browser. */
export function isBackupsSupported(): boolean {
  return (
    typeof indexedDB !== 'undefined' &&
    typeof CompressionStream !== 'undefined' &&
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined'
  );
}

/** List all snapshots, newest first. Blobs are not included. */
export async function listBackups(): Promise<BackupMeta[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const all = await reqAsync(tx.objectStore(STORE).getAll() as IDBRequest<BackupRecord[]>);
    return all
      .map(({ blob: _blob, ...meta }) => meta)
      .sort((a, b) => b.timestamp - a.timestamp);
  } finally {
    db.close();
  }
}

/**
 * Save a new snapshot. If a record with the same content hash already
 * exists, return that record's id and do not create a duplicate.
 * Prunes oldest entries past `MAX_BACKUPS`.
 */
export async function saveBackup(
  xml: string,
  filename: string,
  entryCount: number,
): Promise<SaveResult> {
  const hash = await sha256Hex(xml);
  const db = await openDb();
  try {
    const existing = await reqAsync(
      db
        .transaction(STORE, 'readonly')
        .objectStore(STORE)
        .index('byHash')
        .get(hash) as IDBRequest<BackupRecord | undefined>,
    );
    if (existing) return { id: existing.id, created: false };

    const blob = await gzip(xml);
    const record: Omit<BackupRecord, 'id'> = {
      timestamp: Date.now(),
      filename,
      entryCount,
      byteSize: xml.length,
      hash,
      blob,
    };
    const writeTx = db.transaction(STORE, 'readwrite');
    const addReq = writeTx.objectStore(STORE).add(record) as IDBRequest<IDBValidKey>;
    const newId = (await reqAsync(addReq)) as number;
    await txDone(writeTx);

    await pruneOldest(db);
    return { id: newId, created: true };
  } finally {
    db.close();
  }
}

async function pruneOldest(db: IDBDatabase): Promise<void> {
  const all = await reqAsync(
    db.transaction(STORE, 'readonly').objectStore(STORE).getAll() as IDBRequest<BackupRecord[]>,
  );
  const toDelete = selectIdsToPrune(
    all.map(r => ({ id: r.id, timestamp: r.timestamp })),
    MAX_BACKUPS,
  );
  if (toDelete.length === 0) return;
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const id of toDelete) store.delete(id);
  await txDone(tx);
}

/** Fetch and decompress a snapshot for download. */
export async function restoreBackup(id: number): Promise<{ filename: string; xml: string; timestamp: number }> {
  const db = await openDb();
  try {
    const rec = await reqAsync(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(id) as IDBRequest<
        BackupRecord | undefined
      >,
    );
    if (!rec) throw new Error(`Backup ${id} not found`);
    const xml = await gunzip(rec.blob);
    return { filename: rec.filename, xml, timestamp: rec.timestamp };
  } finally {
    db.close();
  }
}

/** Delete a single snapshot by id. */
export async function deleteBackup(id: number): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}
