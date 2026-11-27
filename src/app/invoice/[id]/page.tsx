import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { getTransaction } from "@/lib/txn-detail";
import { getSetting } from "@/lib/settings";
import { q1, num } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { PrintButton } from "@/components/PrintButton";

type Row = Record<string, string | number | boolean | null>;

/** Printable tax invoice for a sale. Check the layout against current FTA rules before relying on it. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const t = (await getTransaction(id)) as unknown as (Row & { lines: Row[] }) | null;
  if (!t || (t.type !== "sale" && t.type !== "sale_return")) notFound();
  const shop = await getSetting("shop");
  const vat = await getSetting("vat");
  const party = t.party_id ? await q1<{ name: string; trn: string | null; address: string | null }>(`select name, trn, address from parties where id = $1`, [t.party_id]) : null;
  const credit = t.type === "sale_return";
  const title = !vat.registered ? "Invoice" : credit ? "Tax Credit Note" : "Tax Invoice";

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-slate-900">
      <div className="no-print mb-4 flex justify-end"><PrintButton /></div>
      <div className="flex justify-between border-b pb-4">
        <div>
          <div className="text-2xl font-bold">{shop.name}</div>
          <div className="text-sm">{shop.address}</div>
          <div className="text-sm">{shop.phone}</div>
          {vat.registered && <div className="text-sm">TRN: {shop.trn || "—"}</div>}
        </div>
        <div className="text-right">
          <div className="text-xl font-bold uppercase">{title}</div>
          <div className="text-sm">No: {String(t.ref_no)}</div>
          <div className="text-sm">Date: {fmtDate(String(t.txn_date))}</div>
          {t.status === "void" && <div className="font-bold text-rose-600">VOID</div>}
        </div>
      </div>
      <div className="py-4 text-sm">
        <div className="font-semibold">{credit ? "Credited to" : "Bill to"}:</div>
        <div>{party?.name ?? "Cash customer"}</div>
        {party?.address && <div>{party.address}</div>}
        {party?.trn && <div>TRN: {party.trn}</div>}
      </div>
      <table className="w-full text-sm">
        <thead><tr className="border-y bg-slate-50 text-left"><th className="p-2">#</th><th className="p-2">Description</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit price</th><th className="p-2 text-right">Gross amount</th><th className="p-2 text-right">VAT %</th><th className="p-2 text-right">VAT</th><th className="p-2 text-right">Grand total (AED)</th></tr></thead>
        <tbody>{t.lines.map((l) => (
          <tr key={String(l.id)} className="border-b">
            <td className="p-2">{l.line_no}</td><td className="p-2">{l.description}</td>
            <td className="p-2 text-right">{num(l.qty)} {l.unit}</td>
            <td className="p-2 text-right">{(num(l.net_amount) / Math.max(num(l.qty), 1e-9)).toFixed(2)}</td>
            <td className="p-2 text-right">{num(l.net_amount).toFixed(2)}</td><td className="p-2 text-right">{num(l.vat_rate)}</td>
            <td className="p-2 text-right">{num(l.vat_amount).toFixed(2)}</td><td className="p-2 text-right">{num(l.line_total).toFixed(2)}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="ml-auto mt-4 w-64 space-y-1 text-sm">
        <div className="flex justify-between"><span>Gross amount</span><span>{num(t.subtotal).toFixed(2)}</span></div>
        <div className="flex justify-between"><span>VAT</span><span>{num(t.vat_amount).toFixed(2)}</span></div>
        <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Grand total (AED)</span><span>{num(t.total).toFixed(2)}</span></div>
      </div>
      <div className="mt-10 text-center text-xs text-slate-400">Thank you for your business</div>
    </div>
  );
}
