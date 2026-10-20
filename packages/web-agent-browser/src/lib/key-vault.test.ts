import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIdbKeyVault,
  defaultKeyVault,
  KEY_VAULT_DB_NAME,
  KEY_VAULT_PREFIX,
  KEY_VAULT_RECORD_KEY,
  KEY_VAULT_STORE_NAME,
} from "./key-vault";

function deleteVaultDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(KEY_VAULT_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("deleteDatabase failed"));
    req.onblocked = () => resolve();
  });
}

function readAllKeys(): Promise<IDBValidKey[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_VAULT_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_VAULT_STORE_NAME)) {
        db.createObjectStore(KEY_VAULT_STORE_NAME);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(KEY_VAULT_STORE_NAME, "readonly");
      const getAllReq = tx.objectStore(KEY_VAULT_STORE_NAME).getAllKeys();
      tx.oncomplete = () => {
        db.close();
        resolve(getAllReq.result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? getAllReq.error ?? new Error("getAllKeys failed"));
      };
    };
    req.onerror = () => reject(req.error ?? new Error("open failed"));
  });
}

describe("key-vault", () => {
  beforeEach(async () => {
    await deleteVaultDb();
  });

  it("seal and open round trip a non-empty key", async () => {
    const vault = createIdbKeyVault();
    const sealed = await vault.seal("sk-test-123");
    expect(sealed.startsWith(KEY_VAULT_PREFIX)).toBe(true);
    expect(sealed).not.toContain("sk-test-123");
    expect(await vault.open(sealed)).toBe("sk-test-123");
  });

  it("generates a new iv per seal so two seals differ and both open to the same value", async () => {
    const vault = createIdbKeyVault();
    const first = await vault.seal("sk-same-value");
    const second = await vault.seal("sk-same-value");
    expect(first).not.toBe(second);
    expect(await vault.open(first)).toBe("sk-same-value");
    expect(await vault.open(second)).toBe("sk-same-value");
  });

  it("keeps empty string empty without creating a vault record", async () => {
    const vault = createIdbKeyVault();
    expect(await vault.seal("")).toBe("");
    expect(await vault.open("")).toBe("");
    expect(await readAllKeys()).toEqual([]);
  });

  it("passes plain unprefixed values through open unchanged", async () => {
    const vault = createIdbKeyVault();
    expect(await vault.open("abc")).toBe("abc");
    expect(await readAllKeys()).toEqual([]);
  });

  it("returns empty string and does not throw when the vault database is lost after seal", async () => {
    const vault = createIdbKeyVault();
    const sealed = await vault.seal("sk-lost-vault");
    await deleteVaultDb();
    await expect(vault.open(sealed)).resolves.toBe("");
  });

  it("returns empty string when one character of the base64 payload is changed", async () => {
    const vault = createIdbKeyVault();
    const sealed = await vault.seal("sk-tamper-check");
    const b64 = sealed.slice(KEY_VAULT_PREFIX.length);
    const mid = Math.floor(b64.length / 2);
    const flipped = b64[mid] === "A" ? "B" : "A";
    const tampered = KEY_VAULT_PREFIX + b64.slice(0, mid) + flipped + b64.slice(mid + 1);
    expect(await vault.open(tampered)).toBe("");
  });

  it("creates one k1 record when two vault instances seal concurrently and each opens the other's output", async () => {
    const v1 = createIdbKeyVault();
    const v2 = createIdbKeyVault();
    const [s1, s2] = await Promise.all([v1.seal("key-from-v1"), v2.seal("key-from-v2")]);
    expect(await readAllKeys()).toEqual([KEY_VAULT_RECORD_KEY]);
    expect(await v1.open(s2)).toBe("key-from-v2");
    expect(await v2.open(s1)).toBe("key-from-v1");
  });

  it("does not create a k1 record when opening a sealed value with no existing vault record", async () => {
    const writer = createIdbKeyVault();
    const sealed = await writer.seal("sk-no-create-on-read");
    await deleteVaultDb();

    const reader = createIdbKeyVault();
    expect(await reader.open(sealed)).toBe("");
    expect(await readAllKeys()).toEqual([]);
  });

  it("resets keyPromise when loadKey rejects so a subsequent seal succeeds", async () => {
    const vault = createIdbKeyVault();
    const spy = vi.spyOn(crypto.subtle, "generateKey").mockRejectedValueOnce(new Error("rng failure"));
    await expect(vault.seal("sk-retry")).rejects.toThrow("rng failure");
    spy.mockRestore();

    const sealed = await vault.seal("sk-retry");
    expect(await vault.open(sealed)).toBe("sk-retry");
  });

  it("defaultKeyVault returns null on http: and a shared KeyVault on chrome-extension:", () => {
    expect(defaultKeyVault()).toBeNull();
    const origLocation = globalThis.location;
    vi.stubGlobal("location", { protocol: "chrome-extension:" });
    try {
      const first = defaultKeyVault();
      const second = defaultKeyVault();
      expect(first).not.toBeNull();
      expect(first).toBe(second);
    } finally {
      vi.stubGlobal("location", origLocation);
    }
  });
});
