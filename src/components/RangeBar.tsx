"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";

const PRESETS = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["this_week", "This week"], ["this_month", "This month"],
  ["last_month", "Last month"], ["this_year", "This year"], ["custom", "Custom"],
] as const;

/** Date presets + optional filters, kept in the URL so reports are shareable and bookmarkable. */
export function RangeBar({ from, to, extra }: { from: string; to: string; extra?: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const range = sp.get("range") ?? "this_month";
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  function go(p: Record<string, string | null>) {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(p)) { if (v === null) n.delete(k); else n.set(k, v); }
    router.push(`${path}?${n.toString()}`);
  }
  return (
    <div className="no-print mb-4 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(([k, l]) => (
          <button key={k} onClick={() => (k === "custom" ? go({ range: "custom", from: f, to: t }) : go({ range: k, from: null, to: null }))}
            className={clsx("chip px-3 py-1.5 text-sm", range === k ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700")}>{l}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className="input w-auto py-1.5" value={f} onChange={(e) => setF(e.target.value)} />
        <span className="text-slate-400">to</span>
        <input type="date" className="input w-auto py-1.5" value={t} onChange={(e) => setT(e.target.value)} />
        <button className="btn-secondary py-1.5" onClick={() => go({ range: "custom", from: f, to: t })}>Apply</button>
        {extra}
      </div>
    </div>
  );
}

export function SearchFilters({ types }: { types: [string, string][] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const go = (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString());
    if (v) n.set(k, v); else n.delete(k);
    router.push(`${path}?${n.toString()}`);
  };
  return (
    <>
      <select className="input w-auto py-1.5" value={sp.get("type") ?? ""} onChange={(e) => go("type", e.target.value)}>
        <option value="">All types</option>
        {types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <form onSubmit={(e) => { e.preventDefault(); go("q", q); }} className="flex gap-1">
        <input className="input w-48 py-1.5" placeholder="Product, party, ref…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-secondary py-1.5">Search</button>
      </form>
      <label className="flex items-center gap-1 text-sm text-slate-500">
        <input type="checkbox" checked={sp.get("void") === "1"} onChange={(e) => go("void", e.target.checked ? "1" : "")} /> show void
      </label>
    </>
  );
}

export function ExportButtons({ report, from, to }: { report: string; from: string; to: string }) {
  const u = (fmt: string) => `/api/export?report=${report}&from=${from}&to=${to}&format=${fmt}`;
  return (
    <div className="flex gap-1">
      <a className="btn-secondary py-1.5" href={u("xlsx")}>Excel</a>
      <a className="btn-secondary py-1.5" href={u("pdf")} target="_blank">PDF</a>
      <a className="btn-secondary py-1.5" href={u("csv")}>CSV</a>
    </div>
  );
}
