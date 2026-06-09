/**
 * NMLify — disk-source registry.
 *
 * Persists the list of folders the user has added for disk search so they
 * don't have to re-pick on every reload. Two kinds of source:
 *
 *  - FSA sources (Chromium): the `FileSystemDirectoryHandle` itself is
 *    structured-cloneable, so we store it directly. On reload we can
 *    `queryPermission` to see if we still have read access; the browser
 *    typically requires a one-click re-grant rather than picking the
 *    folder again from scratch.
 *
 *  - Fallback sources (Firefox/Safari): no serializable handle exists.
 *    We persist just the displayName + rootPrefix so the row reappears
 *    on reload with a "Re-pick folder" button. Same UX shape as the FSA
 *    flow once the user has re-picked.
 *
 * Scope semantics match backups.ts / crates.ts: per browser profile, per
 * device, per origin. Nothing is uploaded.
 */

const DB_NAME = 'nmlify-disk-sources';
const DB_VERSION = 1;
const STORE = 'sources';

/** Kind discriminator persisted alongside each record. */
export type DiskSourceKind = 'fsa' | 'fallback';

export interface DiskSourceRecord {
  id: number;
  /** Order in the UI list (smaller is earlier). New records get max+1. */
  position: number;
  kind: DiskSourceKind;
  /** Folder display name. For FSA sources this is `handle.name`. */
  displayName: string;
  /** Absolute path prefix the user typed — used to reconstruct Traktor
   *  LOCATIONs. May be empty if the user hasn't filled it in yet. */
  rootPrefix: string;
  /** Present only for kind === 'fsa'. The handle is structured-cloned
   *  into IDB so the browser can re-authorize without a fresh picker. */
  handle: FileSystemDirectoryHandle | null;
}

export interface NewDiskSource {
  kind: DiskSourceKind;
  displayName: string;
  rootPrefix: string;
  handle: FileSystemDirectoryHandle | null;
}

// ---------- IndexedDB wrapper (mirrors backups.ts shape) ----------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        os.createIndex('byPosition', 'position');
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

/** True if the registry can be persisted in this browser. IDB only — the
 *  registry itself is useful even on browsers without the File System
 *  Access API (we store fallback records with handle = null). */
export function isSourcesSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function listSources(): Promise<DiskSourceRecord[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const all = await reqAsync(
      tx.objectStore(STORE).getAll() as IDBRequest<DiskSourceRecord[]>,
    );
    return all.sort((a, b) => a.position - b.position);
  } finally {
    db.close();
  }
}

export async function addSource(input: NewDiskSource): Promise<DiskSourceRecord> {
  const db = await openDb();
  try {
    const existing = await reqAsync(
      db.transaction(STORE, 'readonly').objectStore(STORE).getAll() as IDBRequest<
        DiskSourceRecord[]
      >,
    );
    const nextPos =
      existing.length === 0
        ? 0
        : Math.max(...existing.map((r) => r.position)) + 1;
    const record: Omit<DiskSourceRecord, 'id'> = {
      position: nextPos,
      kind: input.kind,
      displayName: input.displayName,
      rootPrefix: input.rootPrefix,
      handle: input.handle,
    };
    const writeTx = db.transaction(STORE, 'readwrite');
    const addReq = writeTx.objectStore(STORE).add(record) as IDBRequest<IDBValidKey>;
    const newId = (await reqAsync(addReq)) as number;
    await txDone(writeTx);
    return { id: newId, ...record };
  } finally {
    db.close();
  }
}

export async function updateSource(
  id: number,
  patch: Partial<Pick<DiskSourceRecord, 'rootPrefix' | 'displayName' | 'handle'>>,
): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const existing = await reqAsync(store.get(id) as IDBRequest<DiskSourceRecord | undefined>);
    if (!existing) throw new Error(`Disk source ${id} not found`);
    const merged: DiskSourceRecord = { ...existing, ...patch };
    store.put(merged);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function removeSource(id: number): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}
