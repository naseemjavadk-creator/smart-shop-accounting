"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Camera, Upload, Loader2, RefreshCw, CheckCheck, AlertTriangle } from "lucide-react";
import { useCatalog } from "./useCatalog";
import { checkDraft, draftTotal, saveDraft } from "./TxnEditor";
import { billToEntry, type BillDraft } from "./billDraft";
import { compressImage } from "./compress";
import { savePending } from "@/lib/offline/sync";
import { PageHeader, Empty } from "./ui";

type Job = { id: string; status: string; error: string | null; filename: string; file_id: string; confidence: string | null; duplicate_of: string | null; draft: BillDraft | null; supplier: string | null; total: string | null; invoice_no: string | null; ref_no: string | null; created_at: string };

const STATUS: Record<string, [string, string]> = {
  queued: ["Waiting", "bg-slate-100 text-slate-700"],
  processing: ["Reading…", "bg-sky-100 text-sky-800"],
  review: ["Ready to check", "bg-amber-100 text-amber-800"],
  duplicate: ["Already entered?", "bg-rose-100 text-rose-700"],
  saved: ["Saved", "bg-emerald-100 text-emerald-700"],
  failed: ["Could not read", "bg-rose-100 text-rose-700"],
  discarded: ["Discarded", "bg-slate-100 text-slate-500"],
};

/** Why a bill that is ready should be opened and checked by hand instead of saved with the others (null = fine). */
function doubt(j: Job, cat: ReturnType<typeof useCatalog>): string | null {
  const d = j.draft;
  if (j.status !== "review" || !d) return null;
  if (d.duplicate || j.duplicate_of) return `Already saved as ${d.duplicate?.ref_no ?? j.duplicate_of}`;
  if (d.confidence === "low") return "AI is not sure. Please check";
  if (d.document_kind && d.document_kind !== "purchase_bill") return `Looks like a ${d.document_kind.replace("_", " ")}`;
  const entry = billToEntry(d, j);
  const problem = checkDraft(entry, cat);
  if (problem) return problem;
  if (d.total != null && Math.abs(draftTotal(entry, cat) - Number(d.total)) > 0.05) return "Items do not add up to the bill total";
  return null;
}

export function BillScanner() {
  const cat = useCatalog();
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState<Set<string>>(new Set()); // saved here, cloud copy may still be on its way
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/bills").catch(() => null);
    if (r?.ok) setJobs((await r.json()).jobs);
  }, []);

  useEffect(() => { void load(); }, [load]);
  // keep bulk uploads moving while the page is open
  useEffect(() => {
    const active = jobs.some((j) => j.status === "queued" || j.status === "processing");
    if (!active) return;
    const t = setInterval(async () => {
      await fetch("/api/bills/process", { method: "POST" }).catch(() => null);
      await load();
    }, 2500);
    return () => clearInterval(t);
  }, [jobs, load]);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true); setMsg("");
    const files = await Promise.all([...list].map((f) => compressImage(f)));
    if (!navigator.onLine) {
      for (const f of files) await savePending({ kind: "bill", blob: f, filename: f.name });
      setMsg(`${files.length} bill(s) saved on this phone. They will upload and be read when you are online.`);
      setBusy(false);
      return;
    }
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    const r = await fetch("/api/bills", { method: "POST", body: fd }).catch(() => null);
    if (!r) {
      for (const f of files) await savePending({ kind: "bill", blob: f, filename: f.name });
      setMsg("Connection lost. Bills saved on this phone and will upload later.");
    } else {
      const j = await r.json();
      if (!r.ok) setMsg(j.error);
      else {
        const dups = j.jobs.filter((x: { duplicate_file?: boolean }) => x.duplicate_file).length;
        setMsg(`${j.jobs.length} file(s) uploaded. Reading them now…${dups ? ` ${dups} were already uploaded before.` : ""}`);
      }
    }
    setBusy(false);
    void load();
  }

  const ready = jobs.filter((j) => j.status === "review" && j.draft && !sent.has(j.id) && !doubt(j, cat));
  const toCheck = jobs.filter((j) => (j.status === "review" && doubt(j, cat)) || j.status === "duplicate").length;
  const readyTotal = ready.reduce((s, j) => s + Number(j.draft?.total ?? 0), 0);

  async function saveAll() {
    setSaving(true); setMsg("");
    let done = 0; const failed: string[] = [];
    for (const j of ready) {
      try { await saveDraft(billToEntry(j.draft!, j), cat); done++; setSent((x) => new Set(x).add(j.id)); }
      catch (e) { failed.push(`${j.supplier ?? j.filename}: ${e instanceof Error ? e.message : "could not save"}`); }
    }
    setMsg(`${done} bill(s) saved.${failed.length ? ` Not saved: ${failed.join("; ")}.` : ""}${toCheck ? ` ${toCheck} bill(s) still need you to open and check them.` : ""}`);
    setSaving(false);
    setTimeout(() => void load(), 1500);
  }

  return (
    <div>
      <PageHeader title="Scan bills" subtitle="Photo, PDF, Excel or Word. The AI reads the bill; you check it before it is saved." />
      <div className="card mb-5 grid gap-3 p-5 sm:grid-cols-2">
        <button className="btn-primary py-6 text-base" onClick={() => cam.current?.click()} disabled={busy}><Camera size={24} /> Take photo</button>
        <button className="btn-secondary py-6 text-base" onClick={() => pick.current?.click()} disabled={busy}><Upload size={24} /> Upload files (many at once)</button>
        <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
        <input ref={pick} type="file" multiple accept="image/*,application/pdf,.xlsx,.csv,.docx" className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
        {busy && <div className="flex items-center gap-2 text-sm text-slate-500 sm:col-span-2"><Loader2 className="animate-spin" size={16} /> Uploading…</div>}
        {msg && <div className="text-sm text-brand-700 dark:text-brand-100 sm:col-span-2">{msg}</div>}
      </div>
      {ready.length > 0 && (
        <div className="card sticky top-16 z-10 mb-4 flex flex-wrap items-center gap-3 border-emerald-300 bg-emerald-50 p-4 dark:bg-emerald-900/20">
          <div className="text-sm">
            <b>{ready.length} bill(s) ready</b> · total AED {readyTotal.toFixed(2)}
            {toCheck > 0 && <div className="text-xs text-amber-700">{toCheck} other bill(s) need a check first and will not be saved.</div>}
            <div className="text-xs text-slate-500">Tap any bill below to open and fix it before saving.</div>
          </div>
          <button className="btn-primary ml-auto" disabled={saving || !cat} onClick={saveAll}>
            {saving ? <Loader2 className="animate-spin" size={16} /> : <CheckCheck size={18} />} Confirm &amp; save all {ready.length}
          </button>
        </div>
      )}
      <div className="card">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="font-semibold">Bills</div>
          <button className="btn-ghost px-2 py-1" onClick={load}><RefreshCw size={16} /></button>
        </div>
        {jobs.length === 0 ? <Empty>No bills yet.</Empty> : jobs.map((j) => (
          <Link key={j.id} href={`/scan/${j.id}`} className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-sm last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
            <div className="min-w-0">
              <div className="truncate font-medium">{j.supplier ?? j.filename}</div>
              <div className="text-xs text-slate-500">{j.invoice_no ? `Inv ${j.invoice_no} · ` : ""}{j.total ? `AED ${Number(j.total).toFixed(2)} · ` : ""}{new Date(j.created_at).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}{j.ref_no ? ` · ${j.ref_no}` : ""}</div>
              {j.error && <div className="text-xs text-rose-600">{j.error}</div>}
              {doubt(j, cat) && <div className="flex items-center gap-1 text-xs text-amber-700"><AlertTriangle size={12} /> {doubt(j, cat)}</div>}
            </div>
            <span className={clsx("chip shrink-0", STATUS[j.status]?.[1])}>{j.status === "processing" && <Loader2 size={12} className="mr-1 animate-spin" />}{STATUS[j.status]?.[0] ?? j.status}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
