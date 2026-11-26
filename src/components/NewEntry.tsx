"use client";
import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { TxnEditor, KIND_LABEL, emptyDraft, type SavedInfo } from "./TxnEditor";
import { useCatalog } from "./useCatalog";
import type { TxnKind } from "@/lib/offline/types";

const OTHER: TxnKind[] = ["sale", "purchase", "expense", "receipt", "payment", "sale_return", "purchase_return", "stock_adjustment", "transfer"];

export function NewEntry({ type }: { type: TxnKind }) {
  const cat = useCatalog();
  const [saved, setSaved] = useState<SavedInfo | null>(null);
  const [n, setN] = useState(0);
  const owner = cat?.user.role === "owner";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap gap-1.5">
        {OTHER.filter((t) => t !== "transfer" || owner).map((t) => (
          <Link key={t} href={`/new/${t}`} className={`chip px-3 py-1.5 text-sm ${t === type ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>{KIND_LABEL[t]}</Link>
        ))}
      </div>
      <h1 className="mb-4 text-2xl font-bold">New {KIND_LABEL[type].toLowerCase()}</h1>
      {saved ? (
        <div className="card space-y-4 p-6 text-center">
          <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
          <div className="text-lg font-semibold">Saved</div>
          <div className="text-sm text-slate-500">{saved.summary} · AED {saved.total.toFixed(2)}</div>
          <div className="text-xs text-slate-500">Saved on this phone and syncing to the cloud.</div>
          <div className="flex justify-center gap-2">
            <button className="btn-primary" onClick={() => { setSaved(null); setN(n + 1); }}>Add another</button>
            <Link className="btn-secondary" href="/">Dashboard</Link>
          </div>
        </div>
      ) : (
        <div className="card p-4 sm:p-6">
          {cat ? <TxnEditor key={n} initial={emptyDraft(type)} cat={cat} fixedType onSaved={setSaved} /> : <div className="py-10 text-center text-slate-500">Loading…</div>}
        </div>
      )}
    </div>
  );
}
