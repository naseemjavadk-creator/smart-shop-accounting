"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { TxnEditor } from "./TxnEditor";
import { billToEntry, type BillDraft } from "./billDraft";
import { useCatalog } from "./useCatalog";
import type { Draft } from "@/lib/offline/types";

type Job = { id: string; status: string; error: string | null; file_id: string; filename: string; mime: string; txn_id: string | null; result: { draft: BillDraft } | null };

export function BillReview({ id }: { id: string }) {
  const cat = useCatalog();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() { const r = await fetch(`/api/bills/${id}`); if (r.ok) setJob(await r.json()); }
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(action: "retry" | "discard") {
    setBusy(true);
    await fetch(`/api/bills/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    setBusy(false);
    if (action === "discard") router.push("/scan"); else void load();
  }

  if (!job) return <div className="py-10 text-center text-slate-500"><Loader2 className="mx-auto animate-spin" /></div>;
  const d = job.result?.draft;
  const draft: Draft | null = d ? billToEntry(d, job) : null;
  const fileUrl = `/api/files/${job.file_id}`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card overflow-hidden lg:sticky lg:top-20 lg:h-[calc(100dvh-7rem)]">
        {job.mime.startsWith("image/") ? <img src={fileUrl} alt="Bill" className="h-full w-full object-contain" />
          : job.mime === "application/pdf" ? <iframe src={fileUrl} className="h-[70vh] w-full lg:h-full" />
          : <div className="p-6 text-sm"><a className="text-brand-600" href={fileUrl}>Open {job.filename}</a></div>}
      </div>
      <div className="space-y-3">
        <h1 className="text-xl font-bold">Check the bill</h1>
        {job.status === "saved" && <div className="card p-4 text-emerald-700">Saved as a purchase. <Link className="underline" href={`/transactions/${job.txn_id}`}>Open</Link></div>}
        {(job.status === "queued" || job.status === "processing") && <div className="card flex items-center gap-2 p-4"><Loader2 className="animate-spin" size={16} /> Reading the bill… <button className="btn-ghost ml-auto" onClick={load}>Refresh</button></div>}
        {job.status === "failed" && <div className="card p-4 text-rose-600">{job.error} <button className="btn-secondary ml-2" disabled={busy} onClick={() => act("retry")}>Try again</button></div>}
        {d?.duplicate && <div className="card flex items-start gap-2 border-rose-300 bg-rose-50 p-4 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200"><AlertTriangle size={18} /> This supplier invoice ({d.invoice_no}) is already saved as <Link className="underline" href={`/transactions/${d.duplicate.id}`}>{d.duplicate.ref_no}</Link>. Saving again will be blocked.</div>}
        {d && d.document_kind !== "purchase_bill" && <div className="card p-3 text-sm text-amber-700">This looks like a {d.document_kind.replace("_", " ")}, not a supplier bill. Check before saving.</div>}
        {d?.notes && <div className="card p-3 text-sm text-amber-700">AI note: {d.notes}</div>}
        {d && d.total != null && <div className="text-sm text-slate-500">Bill total read by AI: <b>AED {Number(d.total).toFixed(2)}</b>{d.vat_total != null && ` · VAT ${Number(d.vat_total).toFixed(2)}`} · confidence {d.confidence}. Make sure the total below matches.</div>}
        {draft && job.status !== "saved" && (
          <div className="card p-4">
            <TxnEditor initial={draft} cat={cat} fixedType saveLabel="Confirm purchase" onSaved={() => setTimeout(() => router.push("/scan"), 600)} />
          </div>
        )}
        {job.status !== "saved" && <div className="flex gap-2"><button className="btn-ghost" disabled={busy} onClick={() => act("retry")}>Read again</button><button className="btn-ghost text-rose-600" disabled={busy} onClick={() => act("discard")}>Discard</button></div>}
      </div>
    </div>
  );
}
