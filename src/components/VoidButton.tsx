"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function VoidButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  async function go() {
    const r = await fetch(`/api/transactions/${id}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    if (r.ok) { setOpen(false); router.refresh(); } else setErr((await r.json()).error ?? "Failed");
  }
  if (!open) return <button className="btn-secondary text-rose-600" onClick={() => setOpen(true)}>Void / cancel</button>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="input w-64 py-1.5" placeholder="Reason (kept in audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="btn-danger py-1.5" disabled={reason.trim().length < 3} onClick={go}>Void</button>
      <button className="btn-ghost py-1.5" onClick={() => setOpen(false)}>Keep</button>
      {err && <span className="text-sm text-rose-600">{err}</span>}
      <span className="w-full text-xs text-slate-500">Voiding reverses the accounting entries and stock. Nothing is deleted. To correct, void and enter it again.</span>
    </div>
  );
}
