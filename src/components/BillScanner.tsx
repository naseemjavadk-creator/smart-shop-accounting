"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Camera, Upload, Loader2, RefreshCw } from "lucide-react";
import { compressImage } from "./compress";
import { savePending } from "@/lib/offline/sync";
import { PageHeader, Empty } from "./ui";

type Job = { id: string; status: string; error: string | null; filename: string; supplier: string | null; total: string | null; invoice_no: string | null; ref_no: string | null; created_at: string };

const STATUS: Record<string, [string, string]> = {
  queued: ["Waiting", "bg-slate-100 text-slate-700"],
  processing: ["Reading…", "bg-sky-100 text-sky-800"],
  review: ["Ready to check", "bg-amber-100 text-amber-800"],
  duplicate: ["Already entered?", "bg-rose-100 text-rose-700"],
  saved: ["Saved", "bg-emerald-100 text-emerald-700"],
  failed: ["Could not read", "bg-rose-100 text-rose-700"],
  discarded: ["Discarded", "bg-slate-100 text-slate-500"],
};

export function BillScanner() {
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
    }, 4000);
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
            </div>
            <span className={clsx("chip shrink-0", STATUS[j.status]?.[1])}>{j.status === "processing" && <Loader2 size={12} className="mr-1 animate-spin" />}{STATUS[j.status]?.[0] ?? j.status}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
