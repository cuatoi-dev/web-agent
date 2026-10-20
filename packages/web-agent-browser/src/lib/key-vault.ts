import type { KeyVault } from "./types";

export type { KeyVault } from "./types";

export const KEY_VAULT_PREFIX = "enc:v1:";
export const KEY_VAULT_DB_NAME = "wa-key-vault";
export const KEY_VAULT_STORE_NAME = "keys";
export const KEY_VAULT_RECORD_KEY = "k1";

const IV_BYTES = 12;
const TAG_BYTES = 16;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_VAULT_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_VAULT_STORE_NAME)) {
        db.createObjectStore(KEY_VAULT_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(`could not open ${KEY_VAULT_DB_NAME}`));
  });
}

function getKey(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_VAULT_STORE_NAME, "readonly");
    const req = tx.objectStore(KEY_VAULT_STORE_NAME).get(KEY_VAULT_RECORD_KEY);
    tx.oncomplete = () => {
      const val: unknown = req.result;
      resolve(val instanceof CryptoKey ? val : null);
    };
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error(`${KEY_VAULT_DB_NAME} read failed`));
    tx.onabort = () => reject(tx.error ?? req.error ?? new Error(`${KEY_VAULT_DB_NAME} read aborted`));
  });
}

function addKey(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_VAULT_STORE_NAME, "readwrite");
    const req = tx.objectStore(KEY_VAULT_STORE_NAME).add(key, KEY_VAULT_RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(req.error ?? tx.error ?? new Error(`${KEY_VAULT_DB_NAME} add failed`));
    tx.onabort = () => reject(req.error ?? tx.error ?? new Error(`${KEY_VAULT_DB_NAME} add aborted`));
  });
}

async function loadKey(create: boolean): Promise<CryptoKey | null> {
  const db = await openDb();
  try {
    const existing = await getKey(db);
    if (existing) return existing;
    if (!create) return null;
    const fresh = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    try {
      await addKey(db, fresh);
      return fresh;
    } catch (err) {
      if (err && typeof err === "object" && (err as { name?: unknown }).name === "ConstraintError") {
        return await getKey(db);
      }
      throw err;
    }
  } finally {
    db.close();
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function createIdbKeyVault(): KeyVault {
  let keyPromise: Promise<CryptoKey> | null = null;

  function ensureKey(): Promise<CryptoKey> {
    if (!keyPromise) {
      keyPromise = loadKey(true)
        .then((key) => {
          if (!key) throw new Error("could not create vault key");
          return key;
        })
        .catch((err: unknown) => {
          keyPromise = null;
          throw err;
        });
    }
    return keyPromise;
  }

  return {
    async seal(plain: string): Promise<string> {
      if (plain === "") return "";
      const key = await ensureKey();
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const pt = new TextEncoder().encode(plain);
      const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
      const ct = new Uint8Array(ctBuf);
      const combined = new Uint8Array(iv.byteLength + ct.byteLength);
      combined.set(iv, 0);
      combined.set(ct, iv.byteLength);
      return KEY_VAULT_PREFIX + toBase64(combined);
    },

    async open(stored: string): Promise<string> {
      if (stored === "") return "";
      if (!stored.startsWith(KEY_VAULT_PREFIX)) return stored;
      const key = await loadKey(false);
      if (key === null) return "";
      try {
        const b64 = stored.slice(KEY_VAULT_PREFIX.length);
        const bytes = fromBase64(b64);
        if (toBase64(bytes) !== b64 || bytes.byteLength < IV_BYTES + TAG_BYTES) return "";
        const iv = bytes.slice(0, IV_BYTES);
        const ct = bytes.slice(IV_BYTES);
        const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
        return new TextDecoder().decode(ptBuf);
      } catch {
        return "";
      }
    },
  };
}

let sharedVault: KeyVault | null = null;

export function defaultKeyVault(): KeyVault | null {
  if (typeof location !== "undefined" && location.protocol === "chrome-extension:") {
    sharedVault ??= createIdbKeyVault();
    return sharedVault;
  }
  return null;
}
