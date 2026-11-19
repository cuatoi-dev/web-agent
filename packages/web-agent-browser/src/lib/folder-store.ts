import type { FolderStore, SavedFolder } from "@cuatoi/web-agent-vfs";

// The folder button's remembered folders, in the extension origin's
// IndexedDB. chrome.storage cannot hold a FileSystemDirectoryHandle; IndexedDB
// stores it by structured clone. One record per agent: folders:<agentId>.
const DB_NAME = "web-agent-folders";
const STORE = "folders";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(`could not open ${DB_NAME}`));
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? new Error(`${DB_NAME} ${mode} failed`));
    tx.onabort = () => reject(tx.error ?? new Error(`${DB_NAME} ${mode} aborted`));
  });
}

export function indexedDbFolderStore(agentId: string): FolderStore {
  const key = `folders:${agentId}`;
  return {
    async load(): Promise<SavedFolder[]> {
      const db = await openDb();
      try {
        const value = await run<unknown>(db, "readonly", (s) => s.get(key));
        return Array.isArray(value) ? (value as SavedFolder[]) : [];
      } finally {
        db.close();
      }
    },
    async save(folders: SavedFolder[]): Promise<void> {
      const db = await openDb();
      try {
        await run(db, "readwrite", (s) => s.put(folders, key));
      } finally {
        db.close();
      }
    },
  };
}
