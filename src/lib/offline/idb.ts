"use client";
// Tiny IndexedDB wrapper: entries are saved on the phone first, then synced.

const DB_NAME = "smart-shop";
const VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "key" });
        if (!db.objectStoreNames.contains("pending")) db.createObjectStore("pending", { keyPath: "id" });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

async function store(name: string, mode: IDBTransactionMode = "readonly") {
  return (await open()).transaction(name, mode).objectStore(name);
}

export const idb = {
  get: async <T>(s: string, key: IDBValidKey) => req<T | undefined>((await store(s)).get(key) as IDBRequest<T | undefined>),
  put: async (s: string, value: unknown, key?: IDBValidKey) => { await req((await store(s, "readwrite")).put(value, key)); },
  del: async (s: string, key: IDBValidKey) => { await req((await store(s, "readwrite")).delete(key)); },
  all: async <T>(s: string) => req<T[]>((await store(s)).getAll() as IDBRequest<T[]>),
};

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function deviceId(): Promise<string> {
  let id = await idb.get<string>("kv", "device_id");
  if (!id) { id = uuid(); await idb.put("kv", id, "device_id"); }
  return id;
}
