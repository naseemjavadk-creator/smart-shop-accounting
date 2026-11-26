import { notFound } from "next/navigation";
import Link from "next/link";
import { q, q1, num } from "@/lib/db";
import { pageUser, can } from "@/lib/auth";
import { productStats } from "@/lib/reports";
import { monthStart, todayISO, fmtDate } from "@/lib/dates";
import { aed, qty } from "@/lib/money";
import { PageHeader, Card, Stat } from "@/components/ui";
import { ProductForm, type ProductData } from "@/components/ProductForm";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = (await pageUser());
  const { id } = await params;
  const p = await q1<ProductData & { qty_on_hand: string; avg_cost: string; purchase_price: string; selling_price: string; reorder_level: string; expiry_date: string | null }>(
    `select id, name, aliases, sku, barcode, category_id, unit, is_service, purchase_price::float, selling_price::float, reorder_level::float,
            vat_category, expiry_date::text, qty_on_hand, avg_cost from products where id = $1`, [id]);
  if (!p) notFound();
  const cats = await q<{ id: number; name: string }>(`select id, name from categories order by name`);
  const t = todayISO();
  const [stats] = await productStats([id], monthStart(t), t);
  const moves = await q<{ created_at: string; qty_change: string; unit_cost: string; reason: string; ref_no: string; txn_id: string; txn_date: string }>(
    `select m.created_at, m.qty_change, m.unit_cost, m.reason, t.ref_no, t.id txn_id, t.txn_date::text
       from stock_movements m join transactions t on t.id = m.txn_id where m.product_id = $1 order by m.id desc limit 100`, [id]);
  const fin = can(user, "reports");

  return (
    <div className="space-y-4">
      <PageHeader title={p.name} actions={<Link className="btn-secondary" href={`/transactions?range=this_year&q=${encodeURIComponent(p.name)}`}>Transactions</Link>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="In stock" value={p.is_service ? "Service" : `${qty(p.qty_on_hand)} ${p.unit}`} tone={!p.is_service && num(p.qty_on_hand) <= num(p.reorder_level) ? "bad" : "default"} />
        {fin && <Stat label="Average cost" value={aed(p.avg_cost)} hint={`Last purchase ${aed(p.purchase_price)}`} />}
        {fin && <Stat label="Sold this month" value={`${qty(stats?.qty_sold)} ${p.unit}`} hint={aed(num(stats?.sales_net))} />}
        {fin && <Stat label="Profit this month" value={aed(num(stats?.sales_net) - num(stats?.cogs))} tone="good" />}
      </div>
      <ProductForm initial={{ ...p, purchase_price: Number(p.purchase_price), selling_price: Number(p.selling_price), reorder_level: Number(p.reorder_level) }} cats={cats} canDelete={user.role === "owner"} />
      {!p.is_service && (
        <Card className="overflow-x-auto">
          <div className="border-b border-slate-100 px-4 py-3 font-semibold dark:border-slate-800">Stock movements</div>
          <table className="table">
            <thead><tr><th>Date</th><th>Ref</th><th>Reason</th><th className="num">Qty</th>{fin && <th className="num">Unit cost</th>}</tr></thead>
            <tbody>{moves.map((m, i) => (
              <tr key={i}><td>{fmtDate(m.txn_date)}</td><td><Link className="text-brand-600" href={`/transactions/${m.txn_id}`}>{m.ref_no}</Link></td>
                <td className="capitalize">{m.reason.replace("_", " ")}</td>
                <td className={`num ${num(m.qty_change) < 0 ? "text-rose-600" : "text-emerald-600"}`}>{num(m.qty_change) > 0 ? "+" : ""}{qty(m.qty_change)}</td>
                {fin && <td className="num">{num(m.unit_cost).toFixed(2)}</td>}</tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
