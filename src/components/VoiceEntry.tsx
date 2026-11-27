"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Sparkles, CheckCircle2, CloudOff, Loader2, AlertTriangle, PencilLine } from "lucide-react";
import { VoiceRecorder } from "./VoiceRecorder";
import { TxnEditor, KIND_LABEL, emptyDraft, checkDraft, saveDraft, draftTotal, type SavedInfo } from "./TxnEditor";
import { useCatalog } from "./useCatalog";
import { parsedToDraft, type ParsedTxn } from "./parsedToDraft";
import { savePending, pendingItems, removePending, onOutboxChange } from "@/lib/offline/sync";
import type { Draft, PendingItem, TxnKind } from "@/lib/offline/types";

export type Card = { id: string; draft: Draft; parsed?: ParsedTxn; saved?: SavedInfo };

const EXAMPLES = [
  "Today I purchased 10 kg tomatoes for 200 AED",
  "Innu 20 box pen 100 dirhamsinu vangichu",
  "Sold 10 notebooks at 5 AED each",
  "Paid 100 dirhams for shop electricity",
];

const AI_TYPES: TxnKind[] = ["sale", "purchase", "expense", "receipt", "payment", "sale_return", "purchase_return"];

/**
 * Speak or type in your own words → the AI makes the entry → you check and confirm.
 * `hintType` is set when used inside the Sale / Purchase / Expense screen.
 */
export function VoiceEntry({ hintType, embedded }: { hintType?: TxnKind; embedded?: boolean } = {}) {
  const hint = hintType && AI_TYPES.includes(hintType) ? hintType : null;
  const cat = useCatalog();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [understood, setUnderstood] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [online, setOnline] = useState(true);
  const [autoRun, setAutoRun] = useState(false);

  useEffect(() => {
    const load = () => void pendingItems().then((p) => setPending(p.filter((x) => x.kind === "voice")));
    const on = () => setOnline(navigator.onLine);
    load(); on();
    window.addEventListener("online", on); window.addEventListener("offline", on);
    const off = onOutboxChange(load);
    return () => { off(); window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);

  async function understand(input = text, pendingId?: string) {
    const t = input.trim();
    if (!t) return;
    setErr(""); setUnderstood("");
    if (!navigator.onLine || cat?.features.ai === false) {
      if (!navigator.onLine) {
        await savePending({ kind: "voice", text: t });
        setText("");
        setErr("");
        setUnderstood("You are offline. The words are saved on this phone. Tap “Understand” below when you are online, or enter it by hand now.");
        return;
      }
    }
    setBusy(true);
    try {
      const r = await fetch("/api/ai/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t, type: hint }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not understand");
      setUnderstood(j.understood_text);
      const src = autoRun ? "voice" : "text";
      setCards(j.transactions.map((p: ParsedTxn) => ({ id: crypto.randomUUID(), parsed: p, draft: parsedToDraft(p, t, src) })));
      if (!j.transactions.length) setErr("No transaction found in that. Try saying it again with the amount.");
      if (pendingId) await removePending(pendingId);
    } catch (e) {
      if (!navigator.onLine) { await savePending({ kind: "voice", text: t }); setUnderstood("Saved on the phone; will be read when you are online."); }
      else setErr(e instanceof Error ? e.message : "Could not understand");
    }
    setBusy(false);
  }

  function manual() {
    setCards([{ id: crypto.randomUUID(), draft: { ...emptyDraft(hintType ?? "sale"), raw_input: text || null } }]);
  }

  const allSaved = cards.length > 0 && cards.every((c) => c.saved);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {!embedded && <div className="text-center">
        <h1 className="text-2xl font-bold">Speak or type an entry</h1>
        <p className="text-sm text-slate-500">Malayalam, English, Manglish or Arabic. You check everything before it is saved.</p>
      </div>}

      <div className="card p-5">
        <VoiceRecorder serverStt={!!cat?.features.stt} disabled={busy}
          onText={(t, final) => { setText(t); if (final && t) { setAutoRun(true); void understand(t); } }} />
        <div className="mt-5">
          <textarea className="input min-h-24 text-base" placeholder="Or type here, e.g. “Sold 5 boxes of pens for 50 dirhams”"
            value={text} onChange={(e) => { setText(e.target.value); setAutoRun(false); }} />
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => understand()} disabled={busy || !text.trim()}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {busy ? "Understanding…" : "Understand"}
            </button>
            {!embedded && <button className="btn-secondary" onClick={manual}><PencilLine size={16} /> Enter by hand</button>}
          </div>
          {!text && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {EXAMPLES.map((e) => <button key={e} className="chip bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300" onClick={() => setText(e)}>{e}</button>)}
            </div>
          )}
        </div>
        {!online && <p className="mt-3 flex items-center gap-1 text-sm text-amber-600"><CloudOff size={14} /> Offline: entries are saved on this phone and synced later.</p>}
        {understood && <p className="mt-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-700 dark:bg-brand-600/15 dark:text-brand-100">{understood}</p>}
        {err && <p className="mt-3 flex items-center gap-1 text-sm text-rose-600"><AlertTriangle size={14} /> {err}</p>}
      </div>

      {pending.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-semibold">Waiting to be understood ({pending.length})</div>
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2 text-sm dark:bg-slate-800/60">
                <span className="truncate">“{p.text}”</span>
                <div className="flex shrink-0 gap-1">
                  <button className="btn-primary px-3 py-1.5" disabled={!online || busy} onClick={() => { setText(p.text ?? ""); void understand(p.text, p.id); }}>Understand</button>
                  <button className="btn-ghost px-2 py-1.5" onClick={() => removePending(p.id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmCards cards={cards} setCards={setCards} cat={cat} />

      {allSaved && (
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn-primary" onClick={() => { setCards([]); setText(""); setUnderstood(""); }}>New entry</button>
          <Link className="btn-secondary" href="/outbox">See saved entries</Link>
        </div>
      )}
    </div>
  );
}

export function ConfirmCards({ cards, setCards, cat }: { cards: Card[]; setCards: React.Dispatch<React.SetStateAction<Card[]>>; cat: ReturnType<typeof useCatalog> }) {
  // latest edited version of each card (the forms keep their own state)
  const [edits, setEdits] = useState<Record<string, Draft>>({});
  const [bulk, setBulk] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: "" });
  const open = cards.filter((c) => !c.saved);

  async function saveAll() {
    setBulk({ busy: true, msg: "" });
    let saved = 0;
    const skipped: string[] = [];
    for (const [i, c] of cards.entries()) {
      if (c.saved) continue;
      const d = edits[c.id] ?? c.draft;
      const problem = c.parsed?.confidence === "low" ? "unclear, please check" : checkDraft(d, cat);
      if (problem) { skipped.push(`${i + 1}: ${problem}`); continue; }
      const info = await saveDraft(d, cat);
      saved++;
      setCards((cs) => cs.map((x) => (x.id === c.id ? { ...x, saved: info } : x)));
    }
    setBulk({ busy: false, msg: `Saved ${saved}.${skipped.length ? ` Check and save these yourself: ${skipped.join("; ")}` : ""}` });
  }

  return (
    <>
      {open.length > 1 && (
        <div className="card sticky top-16 z-20 flex flex-wrap items-center justify-between gap-2 border-brand-300 bg-brand-50 p-3 dark:bg-brand-600/15">
          <div className="text-sm">
            <b>{open.length} entries</b> · AED {open.reduce((s, c) => s + draftTotal(edits[c.id] ?? c.draft, cat), 0).toFixed(2)}
            <div className="text-xs text-slate-500">Look through them below, fix anything wrong, then save all at once.</div>
          </div>
          <button className="btn-primary" disabled={bulk.busy} onClick={saveAll}>
            {bulk.busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Confirm &amp; save all {open.length}
          </button>
          {bulk.msg && <div className="w-full text-sm text-brand-700 dark:text-brand-100">{bulk.msg}</div>}
        </div>
      )}
      {cards.map((c, i) => (
        <div key={c.id} className={clsx("card p-4", c.saved && "opacity-80")}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="font-semibold">{cards.length > 1 ? `${i + 1}. ` : ""}Check and confirm: {KIND_LABEL[c.draft.type]}</div>
            {c.parsed && (
              <span className={clsx("chip", c.parsed.confidence === "high" ? "bg-emerald-100 text-emerald-700" : c.parsed.confidence === "medium" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-700")}>
                {c.parsed.confidence === "high" ? "Clear" : c.parsed.confidence === "medium" ? "Please check" : "Unclear: check carefully"}
              </span>
            )}
          </div>
          {c.parsed?.questions?.length ? (
            <ul className="mb-3 space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              {c.parsed.questions.map((q) => <li key={q}>• {q}</li>)}
            </ul>
          ) : null}
          {c.saved ? (
            <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 size={18} /> Saved: {c.saved.summary} · AED {c.saved.total.toFixed(2)}</div>
          ) : (
            <TxnEditor initial={c.draft} cat={cat} compact
              onChange={(d) => setEdits((e) => ({ ...e, [c.id]: d }))}
              onCancel={() => setCards((cs) => cs.filter((x) => x.id !== c.id))}
              onSaved={(s) => setCards((cs) => cs.map((x) => (x.id === c.id ? { ...x, saved: s } : x)))} />
          )}
        </div>
      ))}
    </>
  );
}
