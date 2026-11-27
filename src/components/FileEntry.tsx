"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Upload, Loader2, AlertTriangle, CloudOff } from "lucide-react";
import { compressImage } from "./compress";
import { ConfirmCards, type Card } from "./VoiceEntry";
import { parsedToDraft, type ParsedTxn } from "./parsedToDraft";
import { useCatalog } from "./useCatalog";
import { savePending } from "@/lib/offline/sync";
import type { TxnKind } from "@/lib/offline/types";

const ACCEPT_FILES = "image/*,application/pdf,.pdf,.xlsx,.csv,.docx";

/** Hidden file inputs + one big button: camera ("photo") or any file ("file"). */
function Picker({ kind, multiple, disabled, onFiles }: { kind: "photo" | "file"; multiple?: boolean; disabled?: boolean; onFiles: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="btn-primary w-full py-6 text-base" disabled={disabled} onClick={() => ref.current?.click()}>
        {kind === "photo" ? <><Camera size={26} /> Open camera</> : <><Upload size={26} /> Choose photo, PDF, Excel or Word</>}
      </button>
      <input ref={ref} type="file" className="hidden" multiple={multiple}
        accept={kind === "photo" ? "image/*" : ACCEPT_FILES} capture={kind === "photo" ? "environment" : undefined}
        onChange={(e) => { const l = [...(e.target.files ?? [])]; e.target.value = ""; if (l.length) onFiles(l); }} />
    </>
  );
}

/**
 * Purchases: the bill goes through the bill reader (supplier, TRN, invoice number, duplicate check),
 * then opens the "Check the bill" screen. Offline, bills wait on the phone and upload later.
 */
export function PurchaseBillEntry({ kind }: { kind: "photo" | "file" }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  async function go(list: File[]) {
    setMsg(""); setBusy("Uploading…");
    const files = await Promise.all(list.map((f) => compressImage(f)));
    if (!navigator.onLine) {
      for (const f of files) await savePending({ kind: "bill", blob: f, filename: f.name });
      setBusy(""); setMsg(`${files.length} bill(s) saved on this phone. They will be read when you are online (see Scan bills).`);
      return;
    }
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    const r = await fetch("/api/bills", { method: "POST", body: fd }).catch(() => null);
    if (!r) {
      for (const f of files) await savePending({ kind: "bill", blob: f, filename: f.name });
      setBusy(""); setMsg("Connection lost. Bills saved on this phone and will upload later.");
      return;
    }
    const j = await r.json();
    if (!r.ok) { setBusy(""); setMsg(j.error ?? "Upload failed"); return; }
    const jobs = (j.jobs as { job_id?: string }[]).filter((x) => x.job_id);
    if (jobs.length !== 1) { router.push("/scan"); return; }
    // one bill: wait for it to be read, then open the check screen
    setBusy("Reading the bill…");
    const id = jobs[0].job_id!;
    // read it straight away in this request (if the server already started, just wait for it)
    await fetch(`/api/bills/process?id=${id}`, { method: "POST" }).catch(() => null);
    for (let i = 0; i < 40; i++) {
      const s = await fetch(`/api/bills/${id}`).then((x) => x.json()).catch(() => null);
      if (s && !["queued", "processing"].includes(s.status)) break;
      if (i % 5 === 4) await fetch("/api/bills/process", { method: "POST" }).catch(() => null);
      await new Promise((res) => setTimeout(res, 1200));
    }
    router.push(`/scan/${id}`);
  }

  return (
    <div className="space-y-3">
      <Picker kind={kind} multiple={kind === "file"} disabled={!!busy} onFiles={go} />
      <p className="text-sm text-slate-500">The AI reads the supplier, invoice number, items, VAT and total. You check it next to the bill before it is saved. {kind === "file" && "You can pick many bills at once."}</p>
      {busy && <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={16} className="animate-spin" /> {busy}</div>}
      {msg && <div className="text-sm text-brand-700 dark:text-brand-100">{msg} <Link className="underline" href="/scan">Scan bills</Link></div>}
    </div>
  );
}

/** Sales, expenses and other entries from a photo or file: read by the AI, then checked and confirmed here. */
export function FileEntry({ hintType, kind }: { hintType: TxnKind; kind: "photo" | "file" }) {
  const cat = useCatalog();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [understood, setUnderstood] = useState("");
  const [cards, setCards] = useState<Card[]>([]);

  async function go(list: File[]) {
    setErr(""); setUnderstood("");
    if (!navigator.onLine) { setErr("Reading a file needs internet. Use “Type” now, or try again when you are online."); return; }
    if (cat?.features.ai === false) { setErr("AI is not set up on the server. Use “Type”."); return; }
    setBusy(true);
    try {
      const f = await compressImage(list[0]);
      const fd = new FormData();
      fd.append("file", f, f.name);
      fd.append("type", hintType);
      const r = await fetch("/api/ai/read-file", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not read the file");
      setUnderstood(j.understood_text);
      setCards(j.transactions.map((p: ParsedTxn) => {
        const d = parsedToDraft(p, j.understood_text, "text");
        return { id: crypto.randomUUID(), parsed: p, draft: { ...d, source: "ocr" as const, raw_input: `File: ${f.name}`, file_id: j.file_id } };
      }));
      if (!j.transactions.length) setErr("Nothing to enter was found in that file.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read the file");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Picker kind={kind} disabled={busy} onFiles={go} />
        <p className="text-sm text-slate-500">A bill, receipt, handwritten note or list. The AI fills in the entry; you check it before it is saved.</p>
        {busy && <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={16} className="animate-spin" /> Reading…</div>}
        {understood && <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700 dark:bg-brand-600/15 dark:text-brand-100">{understood}</p>}
        {err && <p className="flex items-center gap-1 text-sm text-rose-600">{navigator.onLine ? <AlertTriangle size={14} /> : <CloudOff size={14} />} {err}</p>}
      </div>
      <ConfirmCards cards={cards} setCards={setCards} cat={cat} />
    </div>
  );
}
