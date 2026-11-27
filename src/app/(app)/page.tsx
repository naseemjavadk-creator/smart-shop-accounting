import Link from "next/link";
import { Mic, Receipt, ShoppingCart, Wallet, ScanLine, AlertTriangle } from "lucide-react";
import { pageUser, can } from "@/lib/auth";
import { periodSummary, balances, lowStock, dailySeries, monthlySeries, listTransactions } from "@/lib/reports";
import { addDays, monthStart, todayISO, fmtDate } from "@/lib/dates";
import { aed, qty } from "@/lib/money";
import { num } from "@/lib/db";
import { Card, Stat, Empty, TypeChip } from "@/components/ui";
import { DailyChart, MonthlyChart } from "@/components/Charts";
import { VoidButton } from "@/components/VoidButton";
import { TYPE_LABEL, type TxnType } from "@/lib/accounting/schema";

// the four things a shop does every day, big and simple (Malayalam hint under each)
const actions = [
  { href: "/new/sale", label: "Sale", ml: "വിൽപ്പന", icon: ShoppingCart, perm: "sales", color: "bg-emerald-600" },
  { href: "/new/purchase", label: "Purchase", ml: "വാങ്ങൽ", icon: Receipt, perm: "purchases", color: "bg-sky-600" },
  { href: "/new/expense", label: "Expense", ml: "ചെലവ്", icon: Wallet, perm: "expenses", color: "bg-amber-500" },
  { href: "/scan", label: "Scan bill", ml: "ബിൽ സ്കാൻ", icon: ScanLine, perm: "purchases", color: "bg-violet-600" },
] as const;

export default async function Dashboard() {
  const user = (await pageUser());
  const t = todayISO();
  const showFinance = can(user, "reports");

  const quick = (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {actions.filter((a) => can(user, a.perm)).map((a) => (
        <Link key={a.href} href={a.href} className="card flex items-center gap-3 p-4 font-semibold hover:border-brand-500 active:scale-95">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white ${a.color}`}><a.icon size={26} /></span>
          <span className="leading-tight">{a.label}<span className="block text-xs font-normal text-slate-500">{a.ml}</span></span>
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

  const moneyOut = today.purchases_gross + today.expenses_gross;
  const vatToPay = month.vat_output - month.vat_input;
  const isNew = recent.length === 0 && month.sales_count === 0 && month.purchase_count === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Today</h1>
          <p className="text-sm text-slate-500">{fmtDate(t)}</p>
        </div>
        <Link href="/entry" className="btn-primary px-5 py-3 text-base lg:hidden"><Mic size={20} /> Speak an entry</Link>
      </div>

      {isNew && (
        <Card className="border-brand-200 bg-brand-50 p-5 dark:bg-brand-600/10">
          <div className="text-lg font-bold">Start in 3 easy steps</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              ["1", "Add your first sale", "ആദ്യ വിൽപ്പന ചേർക്കുക", "Tap Sale, or press the mic and say “2 notebooks 10 dirham cash”.", "/new/sale"],
              ["2", "Scan a supplier bill", "ബിൽ ഫോട്ടോ എടുക്കുക", "Take a photo. The AI reads it, you check and save.", "/scan"],
              ["3", "See your profit", "ലാഭം കാണുക", "Come back here. Money in, money out and profit update by themselves.", "/"],
            ].map(([n, title, ml, text, href]) => (
              <Link key={n} href={href} className="card flex gap-3 p-4 hover:border-brand-500">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 font-bold text-white">{n}</span>
                <span><b>{title}</b><span className="block text-xs text-slate-500">{ml}</span><span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">{text}</span></span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Money in (sales)" value={aed(today.sales_gross)} hint={`${today.sales_count} sales today`} tone="good" />
        <Stat label="Money out (purchases + expenses)" value={aed(moneyOut)} hint={`${today.purchase_count} bills · ${today.expense_count} expenses`} />
        <Stat label="Profit today" value={aed(today.net_profit)} tone={today.net_profit >= 0 ? "good" : "bad"} hint="after cost of goods and expenses" />
        <Link href="/reports?r=vat"><Stat label={vatToPay >= 0 ? "VAT to pay (this month)" : "VAT to get back (this month)"} value={aed(Math.abs(vatToPay))}
          tone={vatToPay > 0 ? "warn" : "default"} hint={`collected ${aed(month.vat_output)} · paid ${aed(month.vat_input)}`} /></Link>
      </div>

      {quick}

      <div>
        <div className="mb-2 font-semibold">My money right now</div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Cash in hand" value={aed(bal.cash)} />
          <Stat label="In the bank" value={aed(bal.bank)} />
          <Link href="/reports?r=receivables"><Stat label="Customers owe me" value={aed(bal.receivable)} tone={bal.receivable > 0 ? "warn" : "default"} /></Link>
          <Link href="/reports?r=payables"><Stat label="I owe suppliers" value={aed(bal.payable)} tone={bal.payable > 0 ? "warn" : "default"} /></Link>
          <Link href="/inventory"><Stat label="Stock left (cost)" value={aed(bal.inventory)} hint={low.length ? `${low.length} items running low` : "nothing running low"} /></Link>
        </div>
      </div>

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between"><div className="font-semibold">Last 30 days</div><div className="text-xs text-slate-500">This month: sales {aed(month.sales_gross)} · profit {aed(month.net_profit)}</div></div>
        <DailyChart data={daily} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="font-semibold">Latest entries</div>
            <Link href="/transactions" className="text-sm text-brand-600">See all</Link>
          </div>
          {recent.length === 0 ? <Empty>Nothing yet. Tap Sale or the microphone to add the first one.</Empty> : recent.map((r) => (
            <Link key={r.id} href={`/transactions/${r.id}`} className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-sm last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
              <span className="min-w-0 truncate"><TypeChip type={r.type} label={TYPE_LABEL[r.type as TxnType]} /> <span className="ml-1">{r.items ?? r.expense_account ?? r.notes ?? r.party}</span></span>
              <span className="shrink-0 tabular-nums">{aed(num(r.total))}</span>
            </Link>
          ))}
        </Card>
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} className="text-amber-500" /> Running low</div>
            <Link href="/inventory?filter=low" className="text-sm text-brand-600">See all</Link>
          </div>
          {low.length === 0 ? <Empty>No item is running low.</Empty> : low.slice(0, 8).map((p) => (
            <Link key={p.id} href={`/inventory/${p.id}`} className="flex justify-between border-b border-slate-100 px-4 py-2 text-sm last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
              <span>{p.name}</span><span className="tabular-nums text-rose-600">{qty(p.qty_on_hand)} {p.unit} <span className="text-slate-400">/ min {qty(p.reorder_level)}</span></span>
            </Link>
          ))}
        </Card>
      </div>

      {monthly.length > 1 && (
        <Card className="p-4">
          <div className="mb-2 font-semibold">Month by month</div>
          <MonthlyChart data={monthly} />
        </Card>
      )}
    </div>
  );
}
