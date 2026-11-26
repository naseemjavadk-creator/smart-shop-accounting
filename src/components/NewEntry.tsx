"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { CheckCircle2, Mic, Camera, Upload, PencilLine } from "lucide-react";
import { VoiceEntry } from "./VoiceEntry";
import { FileEntry, PurchaseBillEntry } from "./FileEntry";
import { TxnEditor, KIND_LABEL, emptyDraft, type SavedInfo } from "./TxnEditor";
import { useCatalog } from "./useCatalog";
import type { TxnKind } from "@/lib/offline/types";

const OTHER: TxnKind[] = ["sale", "purchase", "expense", "receipt", "payment", "sale_return", "purchase_return", "stock_adjustment", "transfer"];

type Method = "voice" | "photo" | "file" | "type";
const METHODS: { id: Method; label: string; icon: typeof Mic; color: string }[] = [
  { id: "voice", label: "Speak", icon: Mic, color: "bg-brand-600" },
  { id: "photo", label: "Take photo", icon: Camera, color: "bg-violet-600" },
  { id: "file", label: "Upload file", icon: Upload, color: "bg-sky-600" },
  { id: "type", label: "Type", icon: PencilLine, color: "bg-slate-600" },
];
// stock adjustments and cash ↔ bank transfers are typed only
const AI_OK: TxnKind[] = ["sale", "purchase", "expense", "receipt", "payment", "sale_return", "purchase_return"];

export function NewEntry({ type }: { type: TxnKind }) {
  const cat = useCatalog();
  const aiOk = AI_OK.includes(type);
  const [method, setMethod] = useState<Method>("type");
  // remember the last way this phone entered things
  useEffect(() => {
    const m = localStorage.getItem("entry-method") as Method | null;
    if (m && aiOk && METHODS.some((x) => x.id === m)) setMethod(m);
  }, [aiOk]);
  const choose = (m: Method) => { setMethod(m); localStorage.setItem("entry-method", m); };
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
      <h1 className="mb-3 text-2xl font-bold">New {KIND_LABEL[type].toLowerCase()}</h1>
      {aiOk && !saved && (
        <div className="mb-4">
          <div className="mb-2 text-sm font-medium text-slate-500">How do you want to enter it?</div>
          <div className="grid grid-cols-4 gap-2">
            {METHODS.map((m) => (
              <button key={m.id} type="button" onClick={() => choose(m.id)} aria-pressed={method === m.id}
                className={clsx("card flex flex-col items-center gap-1.5 p-2.5 text-center text-xs font-semibold leading-tight active:scale-95 sm:text-sm",
                  method === m.id ? "!border-brand-500 ring-2 ring-brand-500/40" : "opacity-90")}>
                <span className={clsx("flex h-11 w-11 items-center justify-center rounded-2xl text-white", m.color)}><m.icon size={24} /></span>
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}
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
      ) : aiOk && method === "voice" ? (
        <VoiceEntry key={type} hintType={type} embedded />
      ) : aiOk && (method === "photo" || method === "file") ? (
        <div className="card p-4 sm:p-6">
          {type === "purchase" ? <PurchaseBillEntry key={method} kind={method} /> : <FileEntry key={type + method} hintType={type} kind={method} />}
        </div>
      ) : (
        <div className="card p-4 sm:p-6">
          {cat ? <TxnEditor key={n} initial={emptyDraft(type)} cat={cat} fixedType onSaved={setSaved} /> : <div className="py-10 text-center text-slate-500">Loading…</div>}
        </div>
      )}
    </div>
  );
}
