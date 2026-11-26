"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Loader2, Mic, Square, Trash2 } from "lucide-react";
import clsx from "clsx";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGEST = [
  "How much did I sell today?", "What is my profit this month?", "Which products have low stock?",
  "How much do customers owe me?", "Compare this month's sales with last month", "Which products make the most profit?",
  "ഈ മാസം എത്ര ചെലവായി?", "Give me the November sales report in Excel",
];

export function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => { const s = sessionStorage.getItem("chat"); if (s) setMsgs(JSON.parse(s)); }, []);
  useEffect(() => { sessionStorage.setItem("chat", JSON.stringify(msgs)); end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function send(q = text) {
    const t = q.trim();
    if (!t || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next); setText(""); setBusy(true);
    try {
      const r = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const j = await r.json();
      setMsgs([...next, { role: "assistant", content: r.ok ? j.reply : `⚠️ ${j.error ?? "Something went wrong"}` }]);
    } catch {
      setMsgs([...next, { role: "assistant", content: "⚠️ No connection. The AI chat needs internet." }]);
    }
    setBusy(false);
  }

  function mic() {
    if (listening) { recRef.current?.stop(); return; }
    const W = window as unknown as { SpeechRecognition?: new () => never; webkitSpeechRecognition?: new () => never };
    const C = (W.SpeechRecognition ?? W.webkitSpeechRecognition) as unknown as (new () => { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; start: () => void; stop: () => void }) | undefined;
    if (!C) { alert("Voice is not available in this browser. Please type."); return; }
    const r = new C();
    r.lang = localStorage.getItem("voice-lang") ?? "en-IN"; r.interimResults = true;
    let last = "";
    r.onresult = (e) => { last = Array.from(e.results).map((x) => x[0].transcript).join(" "); setText(last); };
    r.onend = () => { setListening(false); if (last) void send(last); };
    recRef.current = r; r.start(); setListening(true);
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-10rem)] max-w-3xl flex-col lg:h-[calc(100dvh-6rem)]">
      <div className="mb-3 flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">AI accounting chat</h1><p className="text-xs text-slate-500">Answers come from your real records. Ask in English or Malayalam.</p></div>
        {msgs.length > 0 && <button className="btn-ghost" onClick={() => setMsgs([])}><Trash2 size={16} /> Clear</button>}
      </div>
      <div className="card flex-1 space-y-3 overflow-y-auto p-4">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGEST.map((s) => <button key={s} className="chip bg-slate-100 px-3 py-1.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300" onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={clsx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={clsx("max-w-[90%] rounded-2xl px-4 py-2.5 text-sm", m.role === "user" ? "bg-brand-600 text-white" : "prose-chat bg-slate-100 dark:bg-slate-800")}>
              {m.role === "user" ? m.content : <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>}
            </div>
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Checking your records…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="mt-3 flex gap-2">
        <button type="button" onClick={mic} className={clsx("btn px-3", listening ? "bg-rose-600 text-white" : "btn-secondary")}>{listening ? <Square size={18} /> : <Mic size={18} />}</button>
        <input className="input flex-1" placeholder="Ask about sales, profit, stock…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn-primary" disabled={busy || !text.trim()}><Send size={16} /></button>
      </form>
    </div>
  );
}
