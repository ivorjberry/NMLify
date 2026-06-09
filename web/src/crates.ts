/**
 * NMLify — generated crate history.
 *
 * Sibling of backups.ts. Whenever the user downloads a freshly built
 * crate .nml, we stash it here so they can re-download the exact same
 * file later without re-fetching, re-matching, or even staying signed
 * in. Useful when:
 *  - they downloaded the crate, then accidentally deleted it,
 *  - they want to compare two crates they built minutes apart,
 *  - they're testing the matching pipeline and want a history.
 *
 * Differences vs. backups:
 *  - Crates are small (typically <50 KB) — no gzip needed.
 *  - Higher cap (50) since they're cheap.
 *  - No content-hash dedupe: regenerating "Friday Night" after tweaking
 *    selections should produce a new history entry, not silently skip.
 *
 * Scope semantics are identical to backups: per browser profile, per
 * device, per origin. Nothing is uploaded.
 */

import { selectIdsToPrune } from './backups';

export const MAX_CRATES = 50;
const DB_NAME = 'nmlify-crates';
const DB_VERSION = 1;
const STORE = 'crates';

export interface CrateSource {
  /** Always 'spotify' today; reserved for future import types. */
  type: 'spotify';
  /** Original playlist name (not the crate name). */
  playlistName: string;
  /** Open playlist URL the user pasted, when we still have it. */
  playlistUrl: string | null;
  /** Total tracks reported by Spotify for the source playlist. */
  totalTracks: number;
}

export interface CrateMeta {
  id: number;
  /** Epoch ms when the crate was generated/downloaded. */
  timestamp: number;
  /** Crate name (also used to derive the .nml filename). */
  name: string;
  /** Uncompressed XML size in bytes. */
  byteSize: number;
  /** Number of <ENTRY> elements written into the crate. */
  entryCount: number;
  /** Where the crate was derived from. Null if generated without a source. */
  source: CrateSource | null;
}

interface CrateRecord extends CrateMeta {
  /** Generated crate XML (small enough to keep uncompressed). */
  xml: string;
}

// ---------- IndexedDB wrapper (mirrors backups.ts) ----------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        os.createIndex('byTimestamp', 'timestamp');
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

/** True if crate history can be persisted in this browser. */
export function isCratesSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** List all crates, newest first. XML payload is not included. */
export async function listCrates(): Promise<CrateMeta[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const all = await reqAsync(tx.objectStore(STORE).getAll() as IDBRequest<CrateRecord[]>);
    return all
      .map(({ xml: _xml, ...meta }) => meta)
      .sort((a, b) => b.timestamp - a.timestamp);
  } finally {
    db.close();
  }
}

export interface SaveCrateInput {
  name: string;
  xml: string;
  entryCount: number;
  source: CrateSource | null;
}

/** Insert a new crate and prune oldest past MAX_CRATES. */
export async function saveCrate(input: SaveCrateInput): Promise<number> {
  const db = await openDb();
  try {
    const record: Omit<CrateRecord, 'id'> = {
      timestamp: Date.now(),
      name: input.name,
      byteSize: input.xml.length,
      entryCount: input.entryCount,
      source: input.source,
      xml: input.xml,
    };
    const writeTx = db.transaction(STORE, 'readwrite');
    const addReq = writeTx.objectStore(STORE).add(record) as IDBRequest<IDBValidKey>;
    const newId = (await reqAsync(addReq)) as number;
    await txDone(writeTx);
    await pruneOldest(db);
    return newId;
  } finally {
    db.close();
  }
}

async function pruneOldest(db: IDBDatabase): Promise<void> {
  const all = await reqAsync(
    db.transaction(STORE, 'readonly').objectStore(STORE).getAll() as IDBRequest<CrateRecord[]>,
  );
  const toDelete = selectIdsToPrune(
    all.map(r => ({ id: r.id, timestamp: r.timestamp })),
    MAX_CRATES,
  );
  if (toDelete.length === 0) return;
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const id of toDelete) store.delete(id);
  await txDone(tx);
}

/** Fetch a saved crate's XML for re-download. */
export async function restoreCrate(id: number): Promise<CrateMeta & { xml: string }> {
  const db = await openDb();
  try {
    const rec = await reqAsync(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(id) as IDBRequest<
        CrateRecord | undefined
      >,
    );
    if (!rec) throw new Error(`Crate ${id} not found`);
    return rec;
  } finally {
    db.close();
  }
}

/** Delete a single crate by id. */
export async function deleteCrate(id: number): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}
