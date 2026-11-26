import Link from "next/link";
import { Plus } from "lucide-react";
import { q, num } from "@/lib/db";
import { pageUser, can } from "@/lib/auth";
import { aed, qty } from "@/lib/money";
import { PageHeader, Card, Empty } from "@/components/ui";
import { InventorySearch } from "@/components/InventorySearch";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = (await pageUser());
  const sp = await searchParams;
  const s = sp.q?.trim() || null;
  const low = sp.filter === "low";
  const rows = await q<{ id: string; name: string; unit: string; is_service: boolean; qty_on_hand: string; reorder_level: string; avg_cost: string;
    selling_price: string; category: string | null; expiry_date: string | null; sku: string | null }>(
    `select p.id, p.name, p.unit, p.is_service, p.qty_on_hand, p.reorder_level, p.avg_cost, p.selling_price, p.sku, p.expiry_date::text, c.name category
       from products p left join categories c on c.id = p.category_id
      where p.active and ($1::text is null or p.name ilike '%'||$1||'%' or p.sku = $1 or p.barcode = $1 or exists (select 1 from unnest(p.aliases) a where a ilike '%'||$1||'%'))
        and (not $2 or (not p.is_service and p.qty_on_hand <= p.reorder_level))
        and ($3::int is null or p.category_id = $3)
      order by c.name nulls last, p.name`, [s, low, sp.cat ? Number(sp.cat) : null]);
  const cats = await q<{ id: number; name: string }>(`select id, name from categories order by name`);
  const value = rows.reduce((t, r) => t + (r.is_service ? 0 : Math.max(num(r.qty_on_hand), 0) * num(r.avg_cost)), 0);
  const seeCost = can(user, "reports");

  return (
    <div>
      <PageHeader title="Inventory" subtitle={`${rows.length} products${seeCost ? ` · stock value ${aed(value)}` : ""}`}
        actions={<>
          <Link className="btn-secondary" href="/new/stock_adjustment">Adjust stock</Link>
          {can(user, "purchases") && <Link className="btn-primary" href="/inventory/new"><Plus size={16} /> Add product</Link>}
        </>} />
      <InventorySearch cats={cats} />
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <Empty>No products found. Products are also created automatically from purchases.</Empty> : (
          <table className="table">
            <thead><tr><th>Product</th><th>Category</th><th className="num">In stock</th>{seeCost && <th className="num">Avg cost</th>}<th className="num">Selling price</th>{seeCost && <th className="num">Value</th>}</tr></thead>
            <tbody>{rows.map((p) => {
              const isLow = !p.is_service && num(p.qty_on_hand) <= num(p.reorder_level);
              return (
                <tr key={p.id}>
                  <td><Link className="font-medium text-brand-600" href={`/inventory/${p.id}`}>{p.name}</Link>{p.sku && <span className="ml-1 text-xs text-slate-400">{p.sku}</span>}
                    {p.expiry_date && <div className="text-xs text-amber-600">Expires {p.expiry_date}</div>}</td>
                  <td className="text-slate-500">{p.category ?? ""}</td>
                  <td className={`num ${isLow ? "font-semibold text-rose-600" : ""}`}>{p.is_service ? <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800">service</span> : `${qty(p.qty_on_hand)} ${p.unit}`}</td>
                  {seeCost && <td className="num">{num(p.avg_cost).toFixed(2)}</td>}
                  <td className="num">{num(p.selling_price).toFixed(2)}</td>
                  {seeCost && <td className="num">{p.is_service ? "" : (Math.max(num(p.qty_on_hand), 0) * num(p.avg_cost)).toFixed(2)}</td>}
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
