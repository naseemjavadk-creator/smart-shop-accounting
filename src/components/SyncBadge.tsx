"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CloudOff, CloudUpload, CheckCircle2, AlertTriangle } from "lucide-react";
import { onOutboxChange, outbox, pendingItems } from "@/lib/offline/sync";

export function SyncBadge() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [errors, setErrors] = useState(0);

  useEffect(() => {
    const load = async () => {
      const items = await outbox();
      const p = await pendingItems();
      setPending(items.filter((i) => i.status === "pending" || i.status === "syncing").length + p.length);
      setErrors(items.filter((i) => i.status === "error").length);
    };
    const on = () => setOnline(navigator.onLine);
    on(); void load();
    window.addEventListener("online", on); window.addEventListener("offline", on);
    const off = onOutboxChange(load);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); off(); };
  }, []);

  if (errors) return <Link href="/outbox" className="chip gap-1 bg-rose-100 px-2.5 py-1 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"><AlertTriangle size={14} /> {errors} need fixing</Link>;
  if (!online) return <Link href="/outbox" className="chip gap-1 bg-amber-100 px-2.5 py-1 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"><CloudOff size={14} /> Offline{pending ? ` · ${pending} saved on phone` : ""}</Link>;
  if (pending) return <Link href="/outbox" className="chip gap-1 bg-sky-100 px-2.5 py-1 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300"><CloudUpload size={14} /> Syncing {pending}</Link>;
  return <Link href="/outbox" className="chip gap-1 bg-emerald-50 px-2.5 py-1 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><CheckCircle2 size={14} /> Synced</Link>;
}
