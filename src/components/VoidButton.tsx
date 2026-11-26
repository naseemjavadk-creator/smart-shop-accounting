"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";

/**
 * "Delete" for a saved entry. Behind the scenes the entry is voided: its accounting and stock effects are
 * reversed, and it stays in the history (crossed out) with the reason, so the books always add up.
 */
export function VoidButton({ id, refNo, compact }: { id: string; refNo?: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    setBusy(true); setErr("");
    const r = await fetch(`/api/transactions/${id}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }).catch(() => null);
    setBusy(false);
    if (!r) { setErr("No internet. Try again when you are online."); return; }
    if (r.ok) { setOpen(false); setReason(""); router.refresh(); } else setErr((await r.json().catch(() => ({}))).error ?? "Could not delete");
  }

  return (
    <>
      {compact ? (
        <button className="btn-ghost px-2 py-1 text-rose-600" onClick={() => setOpen(true)} aria-label={`Delete ${refNo ?? "entry"}`} title="Delete"><Trash2 size={16} /></button>
      ) : (
        <button className="btn-secondary text-rose-600" onClick={() => setOpen(true)}><Trash2 size={16} /> Delete entry</button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => !busy && setOpen(false)}>
          <div className="card w-full max-w-md space-y-3 p-5 text-left" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Delete entry">
            <div className="text-lg font-bold">Delete {refNo ?? "this entry"}?</div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              The amounts and stock from this entry will be removed from the books. It stays in the history, crossed out, with your reason.
              If it was a mistake, enter it again correctly after deleting.
            </p>
            <div>
              <label className="label">Why? (required)</label>
              <input className="input" autoFocus placeholder="e.g. wrong amount, entered twice" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {err && <div className="text-sm text-rose-600">{err}</div>}
            <div className="flex gap-2">
              <button className="btn-danger flex-1 py-3" disabled={busy || reason.trim().length < 3} onClick={go}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Yes, delete
              </button>
              <button className="btn-secondary flex-1 py-3" disabled={busy} onClick={() => setOpen(false)}>No, keep it</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
