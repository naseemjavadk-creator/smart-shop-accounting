"use client";
import { idb, uuid, deviceId } from "./idb";
import type { Catalog, OutboxItem, PendingItem } from "./types";

const EVT = "shop-outbox";
export const notify = () => window.dispatchEvent(new Event(EVT));
export const onOutboxChange = (fn: () => void) => {
  window.addEventListener(EVT, fn);
  return () => window.removeEventListener(EVT, fn);
};

export async function getCatalog(): Promise<Catalog | null> {
  return (await idb.get<Catalog>("kv", "catalog")) ?? null;
}

export async function refreshCatalog(): Promise<Catalog | null> {
  try {
    const r = await fetch("/api/catalog", { cache: "no-store" });
    if (r.status === 401) return null;
    if (!r.ok) return getCatalog();
    const c = (await r.json()) as Catalog;
    await idb.put("kv", c, "catalog");
    window.dispatchEvent(new Event("shop-catalog"));
    return c;
  } catch {
    return getCatalog();
  }
}

/** Save a confirmed entry on this device. It is synced to the cloud as soon as possible. */
export async function saveEntry(payload: Record<string, unknown>, summary: string, total: number): Promise<OutboxItem> {
  const key = (payload.idempotency_key as string) || `${await deviceId()}:${uuid()}`;
  const item: OutboxItem = {
    key, summary, total, status: "pending", attempts: 0, created_at: new Date().toISOString(),
    payload: { ...payload, idempotency_key: key, device_id: await deviceId() },
  };
  await idb.put("outbox", item);
  notify();
  void syncNow();
  return item;
}

export async function outbox(): Promise<OutboxItem[]> {
  return (await idb.all<OutboxItem>("outbox")).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function removeOutbox(key: string) {
  await idb.del("outbox", key);
  notify();
}

export async function retryOutbox(key: string, payload?: Record<string, unknown>) {
  const it = await idb.get<OutboxItem>("outbox", key);
  if (!it) return;
  await idb.put("outbox", { ...it, payload: payload ?? it.payload, status: "pending", error: undefined });
  notify();
  void syncNow();
}

export async function savePending(p: Omit<PendingItem, "id" | "created_at">) {
  await idb.put("pending", { ...p, id: uuid(), created_at: new Date().toISOString() });
  notify();
}
export const pendingItems = () => idb.all<PendingItem>("pending");
export const removePending = async (id: string) => { await idb.del("pending", id); notify(); };

let running: Promise<void> | null = null;

/** Upload everything waiting on this phone. Safe to call often; only one run at a time. */
export function syncNow(): Promise<void> {
  if (running) return running;
  running = (async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const all = await idb.all<OutboxItem>("outbox");
    const waiting = all.filter((i) => i.status === "pending" || i.status === "syncing");
    for (let i = 0; i < waiting.length; i += 20) {
      const batch = waiting.slice(i, i + 20);
      for (const it of batch) await idb.put("outbox", { ...it, status: "syncing", attempts: it.attempts + 1 });
      notify();
      let res: Response;
      try {
        res = await fetch("/api/sync", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: batch.map((b) => b.payload) }),
        });
      } catch {
        for (const it of batch) await idb.put("outbox", { ...it, status: "pending" });
        notify();
        return; // offline again; try later
      }
      if (!res.ok) {
        for (const it of batch) await idb.put("outbox", { ...it, status: "pending", error: res.status === 401 ? "Sign in to sync" : `Server error ${res.status}` });
        notify();
        return;
      }
      const { results } = (await res.json()) as { results: { idempotency_key: string; ok: boolean; retry?: boolean; error?: string; ref_no?: string; warnings?: string[] }[] };
      for (const r of results) {
        const it = batch.find((b) => b.key === r.idempotency_key);
        if (!it) continue;
        if (r.ok) await idb.put("outbox", { ...it, status: "synced", ref_no: r.ref_no, warnings: r.warnings, error: undefined, synced_at: new Date().toISOString() });
        else await idb.put("outbox", { ...it, status: r.retry ? "pending" : "error", error: r.error });
      }
      notify();
    }
    // upload bill photos taken while offline
    for (const p of await idb.all<PendingItem>("pending")) {
      if (p.kind !== "bill" || !p.blob) continue;
      const fd = new FormData();
      fd.append("files", p.blob, p.filename || "bill.jpg");
      try {
        const r = await fetch("/api/bills", { method: "POST", body: fd });
        if (r.ok) await idb.del("pending", p.id);
      } catch { break; }
    }
    // keep a week of synced history on the phone
    const cutoff = Date.now() - 7 * 864e5;
    for (const it of await idb.all<OutboxItem>("outbox")) {
      if (it.status === "synced" && it.synced_at && Date.parse(it.synced_at) < cutoff) await idb.del("outbox", it.key);
    }
    notify();
  })().finally(() => { running = null; });
  return running;
}

export function startSyncLoop() {
  const tick = () => void syncNow();
  window.addEventListener("online", () => { tick(); void refreshCatalog(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
  const t = setInterval(tick, 30_000);
  tick();
  return () => clearInterval(t);
}
