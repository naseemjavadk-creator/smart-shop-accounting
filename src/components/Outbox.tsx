"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { RefreshCw, Trash2 } from "lucide-react";
import { outbox, onOutboxChange, syncNow, removeOutbox, retryOutbox, pendingItems, removePending } from "@/lib/offline/sync";
import type { OutboxItem, PendingItem } from "@/lib/offline/types";
import { PageHeader, Empty } from "./ui";

const STATUS: Record<OutboxItem["status"], [string, string]> = {
  pending: ["Waiting to sync", "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"],
  syncing: ["Syncing…", "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300"],
  synced: ["Synced", "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"],
  error: ["Needs fixing", "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"],
};

export function Outbox() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [pend, setPend] = useState<PendingItem[]>([]);
  useEffect(() => {
    const load = async () => { setItems(await outbox()); setPend(await pendingItems()); };
    void load();
    return onOutboxChange(load);
  }, []);

  return (
    <div>
      <PageHeader title="Saved on this phone" subtitle="Every entry is saved here first, then sent to the cloud automatically."
        actions={<button className="btn-secondary" onClick={() => syncNow()}><RefreshCw size={16} /> Sync now</button>} />
      {pend.length > 0 && (
        <div className="card mb-4 p-4">
          <div className="mb-2 text-sm font-semibold">Waiting for internet ({pend.length})</div>
          {pend.map((p) => (
            <div key={p.id} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
              <span>{p.kind === "voice" ? `🎤 “${p.text}”` : `🧾 Bill photo ${p.filename ?? ""}`}</span>
              <div className="flex gap-1">
                {p.kind === "voice" && <Link href="/entry" className="btn-ghost px-2 py-1 text-xs">Open</Link>}
                <button className="btn-ghost px-2 py-1" onClick={() => removePending(p.id)}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="card divide-y divide-slate-100 dark:divide-slate-800">
        {items.length === 0 && <Empty>Nothing saved on this phone yet.</Empty>}
        {items.map((i) => (
          <div key={i.key} className="flex flex-wrap items-start justify-between gap-2 p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{i.summary}</div>
              <div className="text-xs text-slate-500">
                {new Date(i.created_at).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })} · AED {i.total.toFixed(2)}
                {i.ref_no && <> · Ref {i.ref_no}</>}
              </div>
              {i.error && <div className="mt-1 text-xs text-rose-600">{i.error}</div>}
              {i.warnings?.map((w) => <div key={w} className="mt-1 text-xs text-amber-600">{w}</div>)}
            </div>
            <div className="flex items-center gap-1">
              <span className={clsx("chip", STATUS[i.status][1])}>{STATUS[i.status][0]}</span>
              {i.status === "error" && (
                <>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => retryOutbox(i.key)}>Retry</button>
                  <button className="btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => { if (confirm("Delete this unsynced entry from the phone?")) void removeOutbox(i.key); }}>Delete</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
