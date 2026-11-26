"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function InventorySearch({ cats }: { cats: { id: number; name: string }[] }) {
  const router = useRouter(); const path = usePathname(); const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const go = (k: string, v: string) => { const n = new URLSearchParams(sp.toString()); if (v) n.set(k, v); else n.delete(k); router.push(`${path}?${n}`); };
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <form onSubmit={(e) => { e.preventDefault(); go("q", q); }} className="flex gap-1">
        <input className="input w-56 py-1.5" placeholder="Search name, SKU, barcode" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-secondary py-1.5">Search</button>
      </form>
      <select className="input w-auto py-1.5" value={sp.get("cat") ?? ""} onChange={(e) => go("cat", e.target.value)}>
        <option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={sp.get("filter") === "low"} onChange={(e) => go("filter", e.target.checked ? "low" : "")} /> Low stock only</label>
    </div>
  );
}
