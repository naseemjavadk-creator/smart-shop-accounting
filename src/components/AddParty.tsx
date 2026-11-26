"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { refreshCatalog } from "@/lib/offline/sync";

export function AddParty({ kind }: { kind: "customer" | "supplier" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", phone: "", trn: "" });
  const [err, setErr] = useState("");
  async function save() {
    const r = await fetch("/api/parties", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ...f }) });
    if (!r.ok) { setErr((await r.json()).error); return; }
    setOpen(false); setF({ name: "", phone: "", trn: "" }); void refreshCatalog(); router.refresh();
  }
  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Add {kind}</button>;
  return (
    <div className="card flex flex-wrap items-end gap-2 p-3">
      <input className="input w-48" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="input w-36" placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      <input className="input w-36" placeholder="TRN" value={f.trn} onChange={(e) => setF({ ...f, trn: e.target.value })} />
      <button className="btn-primary" disabled={!f.name.trim()} onClick={save}>Save</button>
      <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      {err && <span className="text-sm text-rose-600">{err}</span>}
    </div>
  );
}
