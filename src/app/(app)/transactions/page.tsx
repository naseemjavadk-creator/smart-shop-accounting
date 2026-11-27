import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser, can } from "@/lib/auth";
import { listTransactions } from "@/lib/reports";
import { rangeFromSearch, str } from "@/lib/range";
import { aed } from "@/lib/money";
import { num } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { PageHeader, Card, Empty, TypeChip } from "@/components/ui";
import { VoidButton } from "@/components/VoidButton";
import { RangeBar, SearchFilters, ExportButtons } from "@/components/RangeBar";
import { TYPE_LABEL, type TxnType } from "@/lib/accounting/schema";

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getUser();
  if (!can(user, "reports")) redirect("/");
  const sp = await searchParams;
  const r = rangeFromSearch(sp);
  const rows = await listTransactions({ from: r.from, to: r.to, type: str(sp, "type"), q: str(sp, "q"), include_void: str(sp, "void") === "1", limit: 1000 });
  const total = (t: string) => rows.filter((x) => x.type === t && x.status === "posted").reduce((s, x) => s + num(x.total), 0);
  const report = str(sp, "type") === "sale" ? "sales" : str(sp, "type") === "purchase" ? "purchases" : str(sp, "type") === "expense" ? "expenses" : "transactions";

  return (
    <div>
      <PageHeader title="Transactions" subtitle={`${r.label}: ${fmtDate(r.from)} – ${fmtDate(r.to)} · ${rows.length} entries`}
        actions={<ExportButtons report={report} from={r.from} to={r.to} />} />
      <RangeBar from={r.from} to={r.to} extra={<SearchFilters types={Object.entries(TYPE_LABEL)} />} />
      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        <span>Sales <b>{aed(total("sale"))}</b></span><span>Purchases <b>{aed(total("purchase"))}</b></span><span>Expenses <b>{aed(total("expense"))}</b></span>
      </div>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <Empty>No transactions in this period.</Empty> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Ref</th><th>Type</th><th>Details</th><th>Party</th><th>Pay</th><th className="num">VAT</th><th className="num">Grand total</th><th>By</th><th /></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={t.status === "void" ? "line-through opacity-50" : ""}>
                  <td className="whitespace-nowrap">{fmtDate(t.txn_date)}</td>
                  <td><Link className="text-brand-600" href={`/transactions/${t.id}`}>{t.ref_no}</Link></td>
                  <td><TypeChip type={t.type} label={TYPE_LABEL[t.type as TxnType]} /></td>
                  <td className="max-w-xs truncate">{[t.expense_account, t.items ?? t.notes].filter(Boolean).join(": ")}</td>
                  <td>{t.party ?? ""}</td>
                  <td className="capitalize">{t.payment_method}</td>
                  <td className="num">{num(t.vat_amount).toFixed(2)}</td>
                  <td className="num font-medium">{num(t.total).toFixed(2)}</td>
                  <td className="text-xs text-slate-500">{t.created_by}<br />{t.source}</td>
                  <td>{t.status === "posted" && can(user, "void") ? <VoidButton id={t.id} refNo={t.ref_no} compact /> : t.status === "void" ? <span className="text-xs text-rose-600">Deleted</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
