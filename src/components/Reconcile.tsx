"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Line = { line_id: number; entry_date: string; ref_no: string; type: string; party: string | null; debit: number; credit: number; balance: number; txn_id: string; reconciled_at: string | null };

/** Bank book with ticks: mark each line that appears on the bank statement; compare with the statement balance. */
export function Reconcile({ data }: { data: { account: { code: string; name: string } | null; opening: number; closing: number; lines: Line[] } }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [stmt, setStmt] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const cleared = data.lines.filter((l) => l.reconciled_at).reduce((s, l) => s + l.debit - l.credit, 0);
  const unreconciled = data.lines.filter((l) => !l.reconciled_at);
  const toggle = (id: number) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };

  async function mark(clear: boolean) {
    await fetch("/api/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ line_ids: [...sel], date: clear ? null : date }) });
    setSel(new Set()); router.refresh();
  }
  const diff = stmt ? Number(stmt) - (data.opening + cleared) : null;

  return (
    <div className="card overflow-x-auto">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3 text-sm dark:border-slate-800">
        <b>{data.account?.name}</b>
        <span>Book balance <b>{data.closing.toFixed(2)}</b></span>
        <span>Ticked (cleared) <b>{(data.opening + cleared).toFixed(2)}</b></span>
        <span>{unreconciled.length} not ticked</span>
        <label className="flex items-center gap-1">Statement balance <input className="input w-28 py-1" value={stmt} onChange={(e) => setStmt(e.target.value)} /></label>
        {diff != null && <span className={Math.abs(diff) < 0.005 ? "text-emerald-600" : "text-rose-600"}>Difference {diff.toFixed(2)}</span>}
        <span className="ml-auto flex items-center gap-1">
          <input type="date" className="input w-auto py-1" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn-primary py-1.5" disabled={!sel.size} onClick={() => mark(false)}>Tick selected</button>
          <button className="btn-ghost py-1.5" disabled={!sel.size} onClick={() => mark(true)}>Untick</button>
        </span>
      </div>
      <table className="table">
        <thead><tr><th></th><th>Date</th><th>Ref</th><th>Party</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th><th>On statement</th></tr></thead>
        <tbody>{data.lines.map((l) => (
          <tr key={l.line_id}>
            <td><input type="checkbox" checked={sel.has(l.line_id)} onChange={() => toggle(l.line_id)} /></td>
            <td>{l.entry_date}</td><td><Link className="text-brand-600" href={`/transactions/${l.txn_id}`}>{l.ref_no}</Link></td><td>{l.party ?? ""}</td>
            <td className="num">{l.debit ? l.debit.toFixed(2) : ""}</td><td className="num">{l.credit ? l.credit.toFixed(2) : ""}</td><td className="num">{l.balance.toFixed(2)}</td>
            <td>{l.reconciled_at ? <span className="text-emerald-600">✓ {l.reconciled_at}</span> : ""}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
