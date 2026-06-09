/**
 * NMLify — collection-file handle cache.
 *
 * Stores the single most recently picked `FileSystemFileHandle` for
 * collection.nml in IndexedDB so the user doesn't have to re-pick it on
 * every reload. The browser still gates actual reads behind a permission
 * prompt — we just skip the file-picker UI when we already know which
 * file the user means.
 *
 * Only supported on browsers that have the File System Access API
 * (Chromium-family). Firefox/Safari users keep the legacy `<input
 * type="file">` flow.
 *
 * Like the disk-source registry, scope is per browser profile + per
 * device + per origin. Nothing is uploaded.
 */

const DB_NAME = 'nmlify-collection-handle';
const DB_VERSION = 1;
const STORE = 'handle';
// Single record — we only ever cache one collection at a time.
const HANDLE_KEY = 'current';

export interface CollectionHandleRecord {
  /** Folder/file display name at the time it was picked. Useful as a
   *  status hint if the cached file later becomes unreachable. */
  displayName: string;
  handle: FileSystemFileHandle;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
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

/** True if both IDB and the File System Access API are available. */
export function isCollectionHandleSupported(): boolean {
  return (
    typeof indexedDB !== 'undefined' &&
    typeof window !== 'undefined' &&
    'showOpenFilePicker' in window
  );
}

export async function loadCollectionHandle(): Promise<CollectionHandleRecord | null> {
  if (!isCollectionHandleSupported()) return null;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const rec = await reqAsync(
      tx.objectStore(STORE).get(HANDLE_KEY) as IDBRequest<CollectionHandleRecord | undefined>,
    );
    return rec ?? null;
  } finally {
    db.close();
  }
}

export async function saveCollectionHandle(record: CollectionHandleRecord): Promise<void> {
  if (!isCollectionHandleSupported()) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record, HANDLE_KEY);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function clearCollectionHandle(): Promise<void> {
  if (!isCollectionHandleSupported()) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(HANDLE_KEY);
    await txDone(tx);
  } finally {
    db.close();
  }
}
