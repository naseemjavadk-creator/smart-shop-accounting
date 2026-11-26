import Link from "next/link";
import { Mic, Receipt, ShoppingCart, Wallet, ScanLine, Boxes, MessageSquareText, BarChart3, AlertTriangle } from "lucide-react";
import { pageUser, can } from "@/lib/auth";
import { periodSummary, balances, lowStock, dailySeries, monthlySeries, listTransactions } from "@/lib/reports";
import { addDays, monthStart, todayISO, fmtDate } from "@/lib/dates";
import { aed, qty } from "@/lib/money";
import { num } from "@/lib/db";
import { Card, Stat, Empty, TypeChip } from "@/components/ui";
import { DailyChart, MonthlyChart } from "@/components/Charts";
import { VoidButton } from "@/components/VoidButton";
import { TYPE_LABEL, type TxnType } from "@/lib/accounting/schema";

const actions = [
  { href: "/entry", label: "Voice entry", icon: Mic, color: "bg-brand-600" },
  { href: "/new/purchase", label: "Add purchase", icon: Receipt, perm: "purchases", color: "bg-sky-600" },
  { href: "/new/sale", label: "Add sale", icon: ShoppingCart, perm: "sales", color: "bg-emerald-600" },
  { href: "/new/expense", label: "Add expense", icon: Wallet, perm: "expenses", color: "bg-amber-500" },
  { href: "/scan", label: "Scan bill", icon: ScanLine, perm: "purchases", color: "bg-violet-600" },
  { href: "/inventory", label: "Inventory", icon: Boxes, color: "bg-orange-500" },
  { href: "/chat", label: "AI accounting chat", icon: MessageSquareText, perm: "reports", color: "bg-indigo-600" },
  { href: "/reports", label: "Reports", icon: BarChart3, perm: "reports", color: "bg-teal-600" },
] as const;

export default async function Dashboard() {
  const user = (await pageUser());
  const t = todayISO();
  const showFinance = can(user, "reports");

  const quick = (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
      {actions.filter((a) => !("perm" in a) || can(user, a.perm)).map((a) => (
        <Link key={a.href} href={a.href} className="card flex flex-col items-center gap-1.5 p-2.5 text-center text-xs font-semibold leading-tight hover:border-brand-500 active:scale-95">
          <span className={`flex h-11 w-11 items-center justify-center rounded-2xl text-white ${a.color}`}><a.icon size={24} /></span> {a.label}
        </Link>
      ))}
    </div>
  );

  if (!showFinance) {
    const mine = (await listTransactions({ from: addDays(t, -7), to: t, limit: 30 })).filter((r) => r.created_by === user.name);
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Hello, {user.name}</h1>
        {quick}
        <Card>
          <div className="border-b border-slate-100 px-4 py-3 font-semibold dark:border-slate-800">My entries (last 7 days)</div>
          {mine.length === 0 ? <Empty>No entries yet.</Empty> : mine.map((r) => (
            <div key={r.id} className="flex justify-between border-b border-slate-100 px-4 py-2 text-sm last:border-0 dark:border-slate-800">
              <span><TypeChip type={r.type} label={TYPE_LABEL[r.type as TxnType]} /> {r.items ?? r.notes}</span>
              <span className="flex items-center gap-1 tabular-nums">{aed(r.total)}{can(user, "void") && r.status === "posted" && <VoidButton id={r.id} refNo={r.ref_no} compact />}</span>
            </div>
          ))}
        </Card>
      </div>
    );
  }

  const [today, month, bal, low, daily, monthly, recent] = await Promise.all([
    periodSummary(t, t),
    periodSummary(monthStart(t), t),
    balances(t),
    lowStock(),
    dailySeries(addDays(t, -29), t),
    monthlySeries(monthStart(addDays(monthStart(t), -330)), t),
    listTransactions({ from: addDays(t, -30), to: t, limit: 8 }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Today</h1>
          <p className="text-sm text-slate-500">{fmtDate(t)}</p>
        </div>
        <Link href="/entry" className="btn-primary px-5 py-3 text-base lg:hidden"><Mic size={20} /> Speak an entry</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today's sales" value={aed(today.sales_gross)} hint={`${today.sales_count} sales · net ${aed(today.net_sales)}`} />
        <Stat label="Today's purchases" value={aed(today.purchases_gross)} hint={`${today.purchase_count} bills`} />
        <Stat label="Today's expenses" value={aed(today.expenses_gross)} hint={`${today.expense_count} entries`} />
        <Stat label="Today's profit" value={aed(today.net_profit)} tone={today.net_profit >= 0 ? "good" : "bad"} hint={`Gross profit ${aed(today.gross_profit)}`} />
      </div>

      {quick}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Cash in hand" value={aed(bal.cash)} />
        <Stat label="Bank balance" value={aed(bal.bank)} />
        <Stat label="Customers owe you" value={aed(bal.receivable)} tone={bal.receivable > 0 ? "warn" : "default"} />
        <Stat label="You owe suppliers" value={aed(bal.payable)} tone={bal.payable > 0 ? "warn" : "default"} />
        <Stat label="Stock value (cost)" value={aed(bal.inventory)} hint={`${low.length} low-stock items`} />
      </div>

      <Link href="/reports?r=vat" className="block">
        <div className="mb-2 flex items-center justify-between"><div className="font-semibold">VAT this month</div><span className="text-xs text-brand-600">VAT report →</span></div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="VAT collected on sales" value={aed(month.vat_output)} />
          <Stat label="VAT paid on purchases" value={aed(month.vat_input)} />
          <Stat label={month.vat_output - month.vat_input >= 0 ? "VAT to pay" : "VAT to reclaim"} value={aed(Math.abs(month.vat_output - month.vat_input))}
            tone={month.vat_output - month.vat_input > 0 ? "warn" : "default"} hint={`All periods: ${aed(bal.vat_payable)}`} />
        </div>
      </Link>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between"><div className="font-semibold">Last 30 days</div><div className="text-xs text-slate-500">This month: sales {aed(month.net_sales)} · profit {aed(month.net_profit)}</div></div>
          <DailyChart data={daily} />
        </Card>
        <Card className="p-4">
          <div className="mb-2 font-semibold">Monthly trend & profit</div>
          <MonthlyChart data={monthly} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} className="text-amber-500" /> Low stock</div>
            <Link href="/inventory?filter=low" className="text-sm text-brand-600">View all</Link>
          </div>
          {low.length === 0 ? <Empty>All stock is above reorder level.</Empty> : low.slice(0, 8).map((p) => (
            <Link key={p.id} href={`/inventory/${p.id}`} className="flex justify-between border-b border-slate-100 px-4 py-2 text-sm last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
              <span>{p.name}</span><span className="tabular-nums text-rose-600">{qty(p.qty_on_hand)} {p.unit} <span className="text-slate-400">/ min {qty(p.reorder_level)}</span></span>
            </Link>
          ))}
        </Card>
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="font-semibold">Recent transactions</div>
            <Link href="/transactions" className="text-sm text-brand-600">View all</Link>
          </div>
          {recent.length === 0 ? <Empty>No transactions yet. Tap the microphone to record the first one.</Empty> : recent.map((r) => (
            <Link key={r.id} href={`/transactions/${r.id}`} className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-sm last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
              <span className="min-w-0 truncate"><TypeChip type={r.type} label={TYPE_LABEL[r.type as TxnType]} /> <span className="ml-1">{r.items ?? r.expense_account ?? r.notes ?? r.party}</span></span>
              <span className="shrink-0 tabular-nums">{aed(num(r.total))}</span>
            </Link>
          ))}
        </Card>
      </div>
    </div>
  );
}
