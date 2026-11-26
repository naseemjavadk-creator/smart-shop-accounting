import { notFound } from "next/navigation";
import Link from "next/link";
import { pageUser } from "@/lib/auth";
import { getTransaction } from "@/lib/txn-detail";
import { num } from "@/lib/db";
import { aed, qty } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { PageHeader, Card, TypeChip } from "@/components/ui";
import { VoidButton } from "@/components/VoidButton";
import { TYPE_LABEL, type TxnType } from "@/lib/accounting/schema";

type Row = Record<string, string | number | boolean | null>;

export default async function TxnPage({ params }: { params: Promise<{ id: string }> }) {
  const user = (await pageUser());
  const { id } = await params;
  const t = (await getTransaction(id)) as unknown as (Row & { lines: Row[]; journal: Row[] }) | null;
  if (!t) notFound();
  if (user.role !== "owner" && !user.can_reports && t.created_by !== user.id) notFound();
  const type = t.type as TxnType;

  return (
    <div className="space-y-4">
      <PageHeader title={`${TYPE_LABEL[type]} ${t.ref_no}`}
        subtitle={<>{fmtDate(String(t.txn_date))} · recorded by {t.created_by_name ?? "—"} via {String(t.source)} {t.status === "void" && <span className="chip ml-1 bg-rose-100 text-rose-700">VOID: {String(t.void_reason)}</span>}</>}
        actions={<>
          {(type === "sale") && <Link className="btn-secondary" href={`/invoice/${id}`} target="_blank">Tax invoice</Link>}
          {user.role === "owner" && t.status !== "void" && <VoidButton id={id} />}
        </>} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-3"><div className="label">Type</div><TypeChip type={type} label={TYPE_LABEL[type]} /></Card>
        <Card className="p-3"><div className="label">{t.party_kind === "supplier" ? "Supplier" : "Customer"}</div>{t.party_name ?? "—"}</Card>
        <Card className="p-3"><div className="label">Payment</div><span className="capitalize">{String(t.payment_method)}</span> · paid {aed(num(t.amount_paid))}</Card>
        <Card className="p-3"><div className="label">Total</div><b>{aed(num(t.total))}</b> <span className="text-xs text-slate-500">VAT {aed(num(t.vat_amount))}</span></Card>
      </div>
      {(t.invoice_no || t.notes || t.expense_account || t.raw_input) && (
        <Card className="space-y-1 p-3 text-sm">
          {t.expense_account && <div><span className="label inline">Expense type: </span>{t.expense_account}</div>}
          {t.invoice_no && <div><span className="label inline">Invoice no: </span>{t.invoice_no}</div>}
          {t.notes && <div><span className="label inline">Note: </span>{t.notes}</div>}
          {t.raw_input && <div><span className="label inline">Original words: </span>“{t.raw_input}”</div>}
          {t.file_id && <div><a className="text-brand-600" href={`/api/files/${t.file_id}`} target="_blank">View bill</a></div>}
        </Card>
      )}
      {t.lines.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>#</th><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Net</th><th className="num">VAT</th><th className="num">Total</th>{type === "sale" && <th className="num">Cost (COGS)</th>}</tr></thead>
            <tbody>{t.lines.map((l) => (
              <tr key={String(l.id)}>
                <td>{l.line_no}</td>
                <td>{l.product_id ? <Link className="text-brand-600" href={`/inventory/${l.product_id}`}>{l.description}</Link> : l.description}</td>
                <td className="num">{qty(num(l.qty))} {l.unit}</td><td className="num">{num(l.unit_price).toFixed(2)}</td>
                <td className="num">{num(l.net_amount).toFixed(2)}</td><td className="num">{num(l.vat_amount).toFixed(2)}</td>
                <td className="num font-medium">{num(l.line_total).toFixed(2)}</td>
                {type === "sale" && <td className="num">{num(l.cogs_amount).toFixed(2)}</td>}
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
      {(user.role === "owner" || user.can_reports) && (
        <Card className="overflow-x-auto">
          <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold dark:border-slate-800">Accounting entries (double-entry)</div>
          <table className="table">
            <thead><tr><th>Entry</th><th>Account</th><th>Party</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
            <tbody>{t.journal.map((j, i) => (
              <tr key={i} className={j.is_reversal ? "text-rose-600" : ""}>
                <td className="text-xs">{j.is_reversal ? "Reversal" : "Original"}</td><td>{j.code} {j.account}</td><td>{j.party ?? ""}</td>
                <td className="num">{num(j.debit) ? num(j.debit).toFixed(2) : ""}</td><td className="num">{num(j.credit) ? num(j.credit).toFixed(2) : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
