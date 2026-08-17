const DB_NAME = 'nmlify-generated-stems-handle';
const DB_VERSION = 1;
const STORE = 'handle';
const HANDLE_KEY = 'current';

export interface GeneratedStemsHandleRecord {
  displayName: string;
  handle: FileSystemDirectoryHandle;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
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

export function isGeneratedStemsHandleSupported(): boolean {
  return (
    typeof indexedDB !== 'undefined' &&
    typeof window !== 'undefined' &&
    'showDirectoryPicker' in window
  );
}

export async function loadGeneratedStemsHandle(): Promise<GeneratedStemsHandleRecord | null> {
  if (!isGeneratedStemsHandleSupported()) return null;
  const db = await openDb();
  try {
    const record = await reqAsync(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(HANDLE_KEY) as IDBRequest<
        GeneratedStemsHandleRecord | undefined
      >,
    );
    return record ?? null;
  } finally {
    db.close();
  }
}

export async function saveGeneratedStemsHandle(
  record: GeneratedStemsHandleRecord,
): Promise<void> {
  if (!isGeneratedStemsHandleSupported()) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record, HANDLE_KEY);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function clearGeneratedStemsHandle(): Promise<void> {
  if (!isGeneratedStemsHandleSupported()) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(HANDLE_KEY);
    await txDone(tx);
  } finally {
    db.close();
  }
}
