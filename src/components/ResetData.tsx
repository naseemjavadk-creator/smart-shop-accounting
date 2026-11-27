"use client";
import { useState } from "react";
import { Trash2, Download, Loader2 } from "lucide-react";
import { idb } from "@/lib/offline/idb";
import { notify, refreshCatalog } from "@/lib/offline/sync";

/** Owner: delete every entry and start again (backup first, password and the word DELETE required). */
export function ResetData() {
  const [open, setOpen] = useState(false);
  const [gotBackup, setGotBackup] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function run() {
    setBusy(true); setMsg("");
    const r = await fetch("/api/settings/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm, password }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) { setMsg(`⚠️ ${j.error ?? "No connection. Nothing was deleted."}`); return; }
    // entries waiting on this phone would otherwise be sent again after the reset
    for (const s of ["outbox", "pending"])
      for (const x of await idb.all<{ key?: string; id?: string; company_id?: string }>(s))
        if (!x.company_id || x.company_id === j.company_id) await idb.del(s, (x.key ?? x.id)!);
    await refreshCatalog().catch(() => null);
    notify();
    const d = j.deleted as Record<string, number>;
    setMsg(`Done. ${d.transactions ?? 0} entries, ${d.products ?? 0} products, ${d.parties ?? 0} customers/suppliers and ${d.files ?? 0} bill files deleted. The next entry will be T000001.`);
    setOpen(false); setConfirm(""); setPassword("");
  }

  return (
    <div className="card border-rose-200 p-5 dark:border-rose-900">
      <div className="font-semibold text-rose-700">Delete all data</div>
      <p className="mt-1 text-sm text-slate-500">Removes every sale, purchase, expense, payment, bill, product, stock, customer and supplier, and the activity history. Logins, shop details and VAT settings stay. Entry numbers start again at T000001. This cannot be undone from the app.</p>
      {msg && <div className="mt-3 text-sm">{msg}</div>}
      {!open ? (
        <button className="btn-secondary mt-3 text-rose-600" onClick={() => setOpen(true)}><Trash2 size={16} /> Delete all data…</button>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-sm font-medium">Step 1: keep a copy</div>
            <a className="btn-secondary mt-1" href="/api/backup" onClick={() => setGotBackup(true)}><Download size={16} /> Download backup first</a>
            <div className="mt-1 text-xs text-slate-500">A backup is also kept in the database automatically.</div>
          </div>
          <div>
            <div className="text-sm font-medium">Step 2: confirm</div>
            <input className="input mt-1" placeholder="Type DELETE" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <input className="input mt-2" type="password" placeholder="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary bg-rose-600 hover:bg-rose-700" disabled={busy || !gotBackup || confirm.trim().toUpperCase() !== "DELETE" || !password} onClick={run}>
              {busy ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />} Yes, delete everything
            </button>
            <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {!gotBackup && <div className="text-xs text-amber-700">Download the backup first to turn on the delete button.</div>}
        </div>
      )}
    </div>
  );
}
