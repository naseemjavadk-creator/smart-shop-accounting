"use client";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Mic, Square, Loader2 } from "lucide-react";

type SR = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] & { length: number } }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void;
};

export const LANGS = [
  { code: "ml-IN", label: "മലയാളം" },
  { code: "en-IN", label: "English / Manglish" },
  { code: "ar-AE", label: "العربية" },
];

/**
 * Big microphone. Uses the phone's built-in speech recogniser (free) when it has one;
 * otherwise records audio and sends it to the server's speech-to-text (if configured).
 */
export function VoiceRecorder({ onText, serverStt, disabled }: { onText: (t: string, final: boolean) => void; serverStt: boolean; disabled?: boolean }) {
  const [lang, setLang] = useState("ml-IN");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const recRef = useRef<SR | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const finalText = useRef("");

  const [engine, setEngine] = useState<"phone" | "server">("phone");
  useEffect(() => {
    const l = localStorage.getItem("voice-lang"); if (l) setLang(l);
    if (localStorage.getItem("voice-engine") === "server") setEngine("server");
  }, []);

  const SRClass = typeof window !== "undefined"
    ? ((window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition) : undefined;
  const useServer = serverStt && (!SRClass || engine === "server");

  async function start() {
    setErr("");
    finalText.current = "";
    if (!useServer && SRClass) {
      const rec = new SRClass();
      rec.lang = lang; rec.continuous = true; rec.interimResults = true;
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText.current += r[0].transcript + " ";
          else interim += r[0].transcript;
        }
        onText((finalText.current + interim).trim(), false);
      };
      rec.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") setErr(e.error === "not-allowed" ? "Allow microphone access in your browser settings" : e.error === "network" ? "Speech needs internet. Type instead, or try again." : `Mic error: ${e.error}`); };
      rec.onend = () => { setListening(false); onText(finalText.current.trim(), true); };
      recRef.current = rec;
      rec.start();
      setListening(true);
      return;
    }
    if (!serverStt) { setErr("This browser has no speech recognition. Please type, or use Chrome / Safari."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setListening(false); setBusy(true);
        try {
          const fd = new FormData();
          fd.append("audio", new Blob(chunks, { type: mr.mimeType || "audio/webm" }), "voice");
          const r = await fetch("/api/ai/stt", { method: "POST", body: fd });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          onText(j.text, true);
        } catch (e) { setErr(e instanceof Error ? e.message : "Could not transcribe"); }
        setBusy(false);
      };
      mediaRef.current = mr;
      mr.start();
      setListening(true);
    } catch { setErr("Allow microphone access in your browser settings"); }
  }

  function stop() {
    recRef.current?.stop();
    if (mediaRef.current?.state === "recording") mediaRef.current.stop();
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex flex-wrap justify-center gap-1.5">
        {LANGS.map((l) => (
          <button key={l.code} type="button" onClick={() => { setLang(l.code); localStorage.setItem("voice-lang", l.code); }}
            className={clsx("chip px-3 py-1.5 text-sm", lang === l.code ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300")}>
            {l.label}
          </button>
        ))}
      </div>
      <button type="button" disabled={disabled || busy} onClick={listening ? stop : start}
        className={clsx("relative flex h-36 w-36 items-center justify-center rounded-full text-white shadow-xl transition active:scale-95 disabled:opacity-50",
          listening ? "bg-rose-600" : "bg-brand-600 hover:bg-brand-700")}
        aria-label={listening ? "Stop" : "Start speaking"}>
        {listening && <span className="mic-ring absolute inset-0 rounded-full bg-rose-500" />}
        {busy ? <Loader2 size={52} className="animate-spin" /> : listening ? <Square size={48} className="relative" /> : <Mic size={60} />}
      </button>
      <div className="text-sm text-slate-500">{busy ? "Converting speech…" : listening ? "Listening… tap to stop" : "Tap and speak the purchase, sale or expense"}</div>
      {serverStt && SRClass && (
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span>Voice engine:</span>
          {(["phone", "server"] as const).map((e) => (
            <button key={e} type="button" onClick={() => { setEngine(e); localStorage.setItem("voice-engine", e); }}
              className={clsx("chip px-2 py-0.5", engine === e ? "bg-slate-700 text-white dark:bg-slate-300 dark:text-slate-900" : "bg-slate-100 dark:bg-slate-800")}>
              {e === "phone" ? "Phone" : "Gemini (better Malayalam)"}
            </button>
          ))}
        </div>
      )}
      {err && <div className="text-sm text-rose-600">{err}</div>}
    </div>
  );
}
