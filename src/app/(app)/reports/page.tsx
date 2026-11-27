import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser, can } from "@/lib/auth";
import * as R from "@/lib/reports";
import { q, num } from "@/lib/db";
import { rangeFromSearch, str } from "@/lib/range";
import { aed, qty } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { PageHeader, Card, Empty, Stat } from "@/components/ui";
import { RangeBar, ExportButtons } from "@/components/RangeBar";
import { DailyChart } from "@/components/Charts";
import { Reconcile } from "@/components/Reconcile";
import { PrintButton } from "@/components/PrintButton";
import { TYPE_LABEL, type TxnType } from "@/lib/accounting/schema";

// everyday reports first, in plain words; accounting reports only show under "Advanced"
const SIMPLE = [
  ["summary", "Money in & out"], ["sales", "Best sellers"], ["expenses", "Expenses"], ["receivables", "Customers owe me"],
  ["payables", "I owe suppliers"], ["stock", "Stock left"], ["vat", "VAT"],
] as const;
const ADVANCED = [
  ["pnl", "Profit & loss"], ["balance", "Balance sheet"], ["cashflow", "Cash flow"], ["cash", "Cash book"], ["bank", "Bank book"],
  ["ledger", "General ledger"], ["trial", "Trial balance"], ["monthly", "Month by month"],
] as const;
const TABS = [...SIMPLE, ...ADVANCED];

type SP = Record<string, string | string[] | undefined>;

function Rows({ rows }: { rows: { name: string; amount: number }[] }) {
  return <>{rows.map((r) => <tr key={r.name}><td className="pl-6">{r.name}</td><td className="num">{r.amount.toFixed(2)}</td></tr>)}</>;
}
function Total({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return <tr className={strong ? "bg-slate-50 text-base font-bold dark:bg-slate-800/60" : "font-semibold"}><td>{label}</td><td className="num">{v.toFixed(2)}</td></tr>;
}

async function LedgerTable({ accountId, from, to, reconcile }: { accountId: number; from: string; to: string; reconcile?: boolean }) {
  const l = await R.ledger(accountId, from, to);
  if (reconcile) return <Reconcile data={{ ...l, lines: l.lines.map((x) => ({ ...x, line_id: Number(x.line_id) })) }} />;
  return (
    <Card className="overflow-x-auto">
      <div className="flex justify-between border-b border-slate-100 px-4 py-3 text-sm dark:border-slate-800"><b>{l.account?.code} {l.account?.name}</b><span>Opening {aed(l.opening)} · Closing <b>{aed(l.closing)}</b></span></div>
      {l.lines.length === 0 ? <Empty>No entries in this period.</Empty> : (
        <table className="table">
          <thead><tr><th>Date</th><th>Ref</th><th>Details</th><th>Party</th><th className="num">Debit (in)</th><th className="num">Credit (out)</th><th className="num">Balance</th></tr></thead>
          <tbody>{l.lines.map((x, i) => (
            <tr key={i}><td className="whitespace-nowrap">{fmtDate(x.entry_date)}</td><td><Link className="text-brand-600" href={`/transactions/${x.txn_id}`}>{x.ref_no}</Link></td>
              <td>{TYPE_LABEL[x.type as TxnType] ?? x.type}{x.memo?.startsWith("void") ? " (void)" : ""}</td><td>{x.party ?? ""}</td>
              <td className="num">{x.debit ? x.debit.toFixed(2) : ""}</td><td className="num">{x.credit ? x.credit.toFixed(2) : ""}</td><td className="num font-medium">{x.balance.toFixed(2)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await getUser();
  if (!can(user, "reports")) redirect("/");
  const sp = await searchParams;
  const tab = (str(sp, "r") ?? "summary") as (typeof TABS)[number][0];
  const r = rangeFromSearch(sp);
  const { from, to } = r;
  const accounts = await q<{ id: number; code: string; name: string; system_key: string | null }>(`select id, code, name, system_key from accounts order by code`);
  const accId = (k: string) => accounts.find((a) => a.system_key === k)!.id;

  const exportFor: Record<string, string> = { summary: "daily", monthly: "summary", sales: "sales", expenses: "expenses", pnl: "pnl", trial: "trial_balance", receivables: "receivables", payables: "payables", stock: "stock", vat: "vat" };
  let body: React.ReactNode = null;

  switch (tab) {
    case "summary": {
      const [s, days] = await Promise.all([R.periodSummary(from, to), R.dailySeries(from, to)]);
      body = (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Money in (sales, with VAT)" value={aed(s.sales_gross)} hint={`${s.sales_count} sales · before VAT ${aed(s.net_sales)}`} tone="good" />
            <Stat label="Money out (purchases + expenses)" value={aed(s.purchases_gross + s.expenses_gross)} hint={`${s.purchase_count} bills · ${s.expense_count} expenses`} />
            <Stat label="Profit" value={aed(s.net_profit)} tone={s.net_profit >= 0 ? "good" : "bad"} hint="after cost of goods and expenses" />
            <Stat label="Profit on goods sold" value={aed(s.gross_profit)} hint={`goods cost ${aed(s.cogs)}`} />
            <Stat label="Purchases (before VAT)" value={aed(s.purchases)} />
            <Stat label="Expenses (before VAT)" value={aed(s.expenses)} hint={s.other_costs ? `+ stock loss/other ${aed(s.other_costs)}` : undefined} />
            <Stat label="VAT collected / paid" value={`${aed(s.vat_output)} / ${aed(s.vat_input)}`} />
            <Stat label="Goods returned by customers" value={aed(s.sales_returns)} />
          </div>
          {days.length <= 92 && <Card className="p-4"><DailyChart data={days} /></Card>}
          <Card className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Date</th><th className="num">Net sales</th><th className="num">Cost of goods</th><th className="num">Purchases</th><th className="num">Expenses</th><th className="num">Profit</th></tr></thead>
              <tbody>{days.filter((d) => d.sales || d.purchases || d.expenses || d.cogs).map((d) => (
                <tr key={d.date}><td>{fmtDate(d.date)}</td><td className="num">{d.sales.toFixed(2)}</td><td className="num">{d.cogs.toFixed(2)}</td><td className="num">{d.purchases.toFixed(2)}</td><td className="num">{d.expenses.toFixed(2)}</td><td className={`num font-medium ${d.profit < 0 ? "text-rose-600" : ""}`}>{d.profit.toFixed(2)}</td></tr>
              ))}</tbody>
            </table>
          </Card>
        </div>
      );
      break;
    }
    case "monthly": {
      const months = await R.monthlySeries(from, to);
      body = (
        <Card className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Month</th><th className="num">Net sales</th><th className="num">Cost of goods</th><th className="num">Gross profit</th><th className="num">Purchases</th><th className="num">Expenses</th><th className="num">Net profit</th><th className="num">vs previous</th></tr></thead>
            <tbody>{months.map((m, i) => {
              const prev = months[i - 1];
              const ch = prev && prev.sales ? ((m.sales - prev.sales) / prev.sales) * 100 : null;
              return <tr key={m.month}><td>{m.month}</td><td className="num">{m.sales.toFixed(2)}</td><td className="num">{m.cogs.toFixed(2)}</td><td className="num">{(m.sales - m.cogs).toFixed(2)}</td><td className="num">{m.purchases.toFixed(2)}</td><td className="num">{m.expenses.toFixed(2)}</td><td className="num font-semibold">{m.profit.toFixed(2)}</td><td className={`num ${ch != null && ch < 0 ? "text-rose-600" : "text-emerald-600"}`}>{ch == null ? "" : `${ch > 0 ? "+" : ""}${ch.toFixed(0)}%`}</td></tr>;
            })}</tbody>
          </table>
          <p className="p-3 text-xs text-slate-500">Tip: choose “This year” or a custom range for a longer comparison.</p>
        </Card>
      );
      break;
    }
    case "sales": {
      const rows = await R.topProducts(from, to, "revenue", 500);
      body = (
        <Card className="overflow-x-auto">
          {rows.length === 0 ? <Empty>No sales in this period.</Empty> : (
            <table className="table">
              <thead><tr><th>Product</th><th className="num">Qty sold</th><th className="num">Sales (net)</th><th className="num">Cost</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
              <tbody>{rows.map((p) => <tr key={p.name}><td>{p.name}</td><td className="num">{qty(p.qty)} {p.unit ?? ""}</td><td className="num">{p.revenue.toFixed(2)}</td><td className="num">{p.cogs.toFixed(2)}</td><td className="num font-medium">{p.profit.toFixed(2)}</td><td className="num">{p.revenue ? ((p.profit / p.revenue) * 100).toFixed(0) + "%" : ""}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      );
      break;
    }
    case "expenses": {
      const rows = await R.expensesByCategory(from, to);
      const total = rows.reduce((s, x) => s + x.amount, 0);
      body = (
        <Card className="overflow-x-auto">
          {rows.length === 0 ? <Empty>No expenses in this period.</Empty> : (
            <table className="table"><thead><tr><th>Category</th><th className="num">Amount</th><th className="num">Share</th></tr></thead>
              <tbody>{rows.map((x) => <tr key={x.code}><td>{x.name}</td><td className="num">{x.amount.toFixed(2)}</td><td className="num">{((x.amount / total) * 100).toFixed(0)}%</td></tr>)}<Total label="Total" v={total} strong /></tbody></table>
          )}
          <div className="p-3 text-sm"><Link className="text-brand-600" href={`/transactions?type=expense&range=custom&from=${from}&to=${to}`}>See each expense →</Link></div>
        </Card>
      );
      break;
    }
    case "pnl": {
      const p = await R.profitAndLoss(from, to);
      body = (
        <Card className="overflow-x-auto"><table className="table"><tbody>
          <tr><td colSpan={2} className="font-semibold">Income</td></tr><Rows rows={p.income} /><Total label="Total income" v={p.total_income} />
          <tr><td colSpan={2} className="font-semibold">Cost of goods sold</td></tr><Rows rows={p.cogs} /><Total label="Gross profit" v={p.gross_profit} />
          <tr><td colSpan={2} className="font-semibold">Expenses</td></tr><Rows rows={p.expenses} /><Total label="Total expenses" v={p.total_expenses} />
          <Total label="Net profit" v={p.net_profit} strong />
        </tbody></table></Card>
      );
      break;
    }
    case "balance": {
      const b = await R.balanceSheet(to);
      body = (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="overflow-x-auto"><table className="table"><tbody><tr><td colSpan={2} className="font-semibold">Assets</td></tr><Rows rows={b.assets} /><Total label="Total assets" v={b.total_assets} strong /></tbody></table></Card>
          <Card className="overflow-x-auto"><table className="table"><tbody>
            <tr><td colSpan={2} className="font-semibold">Liabilities</td></tr><Rows rows={b.liabilities} /><Total label="Total liabilities" v={b.total_liabilities} />
            <tr><td colSpan={2} className="font-semibold">Equity</td></tr><Rows rows={b.equity} /><Total label="Total equity" v={b.total_equity} />
            <Total label="Liabilities + equity" v={b.total_liabilities + b.total_equity} strong />
          </tbody></table>
          <p className={`p-3 text-xs ${b.balanced ? "text-emerald-600" : "text-rose-600"}`}>{b.balanced ? "✓ Balanced" : "Not balanced: please contact support"} · as of {fmtDate(to)}</p></Card>
        </div>
      );
      break;
    }
    case "trial": {
      const rows = await R.trialBalance(from, to);
      const d = rows.reduce((s, x) => s + x.debit, 0), c = rows.reduce((s, x) => s + x.credit, 0);
      body = (
        <Card className="overflow-x-auto"><table className="table">
          <thead><tr><th>Code</th><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{rows.map((x) => <tr key={x.code}><td>{x.code}</td><td><Link className="text-brand-600" href={`/reports?r=ledger&account=${x.id}&range=custom&from=${from}&to=${to}`}>{x.name}</Link></td><td className="num">{x.debit ? x.debit.toFixed(2) : ""}</td><td className="num">{x.credit ? x.credit.toFixed(2) : ""}</td></tr>)}
            <tr className="font-bold"><td /><td>Total</td><td className="num">{d.toFixed(2)}</td><td className="num">{c.toFixed(2)}</td></tr></tbody>
        </table></Card>
      );
      break;
    }
    case "cashflow": {
      const cf = await R.cashFlow(from, to);
      body = (
        <Card className="overflow-x-auto"><table className="table">
          <thead><tr><th>Cash + bank movement from</th><th className="num">Money in</th><th className="num">Money out</th><th className="num">Net</th></tr></thead>
          <tbody>
            <tr><td>Opening cash + bank</td><td /><td /><td className="num">{cf.opening.toFixed(2)}</td></tr>
            {cf.items.map((x) => <tr key={x.type}><td>{TYPE_LABEL[x.type as TxnType] ?? x.type}</td><td className="num">{x.inflow.toFixed(2)}</td><td className="num">{x.outflow.toFixed(2)}</td><td className="num">{x.net.toFixed(2)}</td></tr>)}
            <Total label="Net change" v={cf.net_change} /><Total label="Closing cash + bank" v={cf.closing} strong />
          </tbody>
        </table></Card>
      );
      break;
    }
    case "cash": body = <LedgerTable accountId={accId("cash")} from={from} to={to} />; break;
    case "bank": body = <LedgerTable accountId={accId("bank")} from={from} to={to} reconcile={user!.role === "owner"} />; break;
    case "ledger": {
      const id = Number(str(sp, "account") ?? accId("cash"));
      body = (
        <div className="space-y-3">
          <form className="flex gap-2">
            <input type="hidden" name="r" value="ledger" /><input type="hidden" name="range" value="custom" /><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
            <select name="account" defaultValue={id} className="input w-auto">{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select>
            <button className="btn-secondary">Show</button>
          </form>
          <LedgerTable accountId={id} from={from} to={to} />
        </div>
      );
      break;
    }
    case "receivables":
    case "payables": {
      const kind = tab === "receivables" ? "customer" : "supplier";
      const rows = (await R.partyBalances(kind, to)).filter((x) => x.balance !== 0);
      body = (
        <Card className="overflow-x-auto">
          {rows.length === 0 ? <Empty>Nothing outstanding.</Empty> : (
            <table className="table"><thead><tr><th>{kind === "customer" ? "Customer" : "Supplier"}</th><th>Phone</th><th>Last transaction</th><th className="num">Balance</th></tr></thead>
              <tbody>{rows.map((x) => <tr key={x.id}><td>{x.name}</td><td>{x.phone ?? ""}</td><td>{x.last_date ? fmtDate(x.last_date) : ""}</td><td className="num font-medium">{x.balance.toFixed(2)}</td></tr>)}
                <Total label="Total" v={rows.reduce((s, x) => s + x.balance, 0)} strong /></tbody></table>
          )}
        </Card>
      );
      break;
    }
    case "stock": {
      const rows = await R.stockValuation();
      const total = rows.reduce((s, x) => s + num(x.value), 0);
      body = (
        <Card className="overflow-x-auto"><table className="table">
          <thead><tr><th>Product</th><th>Category</th><th className="num">Qty</th><th className="num">Avg cost</th><th className="num">Value at cost</th><th className="num">Value at selling price</th></tr></thead>
          <tbody>{rows.map((x) => <tr key={x.id}><td>{x.name}</td><td>{x.category ?? ""}</td><td className="num">{qty(x.qty_on_hand)} {x.unit}</td><td className="num">{num(x.avg_cost).toFixed(2)}</td><td className="num">{num(x.value).toFixed(2)}</td><td className="num">{num(x.retail_value).toFixed(2)}</td></tr>)}
            <tr className="font-bold"><td colSpan={4}>Total</td><td className="num">{total.toFixed(2)}</td><td className="num">{rows.reduce((s, x) => s + num(x.retail_value), 0).toFixed(2)}</td></tr></tbody>
        </table></Card>
      );
      break;
    }
    case "vat": {
      const v = await R.vatReport(from, to);
      body = (
        <Card className="overflow-x-auto">
          <p className="border-b border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            Working figures to help prepare your VAT return. This is not an FTA submission. Check with your tax agent before filing on EmaraTax.
          </p>
          <table className="table"><tbody>
            <tr><td>Standard-rated sales (net)</td><td className="num">{v.standard_sales.toFixed(2)}</td></tr>
            <tr><td>Output VAT on those sales</td><td className="num">{v.standard_sales_vat.toFixed(2)}</td></tr>
            <tr><td>Zero-rated sales</td><td className="num">{v.zero_rated_sales.toFixed(2)}</td></tr>
            <tr><td>Exempt sales</td><td className="num">{v.exempt_sales.toFixed(2)}</td></tr>
            <tr><td>Standard-rated purchases & expenses (net)</td><td className="num">{v.standard_purchases.toFixed(2)}</td></tr>
            <tr><td>Recoverable input VAT</td><td className="num">{v.standard_purchases_vat.toFixed(2)}</td></tr>
            <Total label={v.net_vat_payable >= 0 ? "Net VAT payable" : "Net VAT refundable"} v={Math.abs(v.net_vat_payable)} strong />
          </tbody></table>
        </Card>
      );
      break;
    }
  }

  return (
    <div>
      <PageHeader title="Reports" subtitle={`${r.label}: ${fmtDate(from)} – ${fmtDate(to)}`}
        actions={exportFor[tab] ? <ExportButtons report={exportFor[tab]} from={from} to={to} /> : <PrintButton />} />
      <div className="no-print -mx-4 mb-4 overflow-x-auto px-4">
        <div className="flex gap-1.5 whitespace-nowrap">
          {(ADVANCED.some(([k]) => k === tab) ? TABS : SIMPLE).map(([k, l]) => {
            const n = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]);
            n.set("r", k); n.delete("account");
            return <Link key={k} href={`/reports?${n}`} className={`chip px-3 py-1.5 text-sm ${tab === k ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"}`}>{l}</Link>;
          })}
          {!ADVANCED.some(([k]) => k === tab) && <Link href="/advanced" className="chip px-3 py-1.5 text-sm text-slate-500 ring-1 ring-slate-200 dark:ring-slate-700">Advanced…</Link>}
        </div>
      </div>
      <RangeBar from={from} to={to} />
      {body}
    </div>
  );
}
