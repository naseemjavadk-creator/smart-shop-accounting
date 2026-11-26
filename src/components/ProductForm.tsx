"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { refreshCatalog } from "@/lib/offline/sync";

export type ProductData = {
  id?: string; name: string; aliases: string[]; sku: string | null; barcode: string | null; category_id: number | null; unit: string;
  is_service: boolean; purchase_price: number; selling_price: number; reorder_level: number; vat_category: "standard" | "zero" | "exempt"; expiry_date: string | null;
};

export function ProductForm({ initial, cats, canDelete }: { initial?: ProductData; cats: { id: number; name: string }[]; canDelete?: boolean }) {
  const router = useRouter();
  const [p, setP] = useState<ProductData>(initial ?? { name: "", aliases: [], sku: null, barcode: null, category_id: null, unit: "piece", is_service: false, purchase_price: 0, selling_price: 0, reorder_level: 0, vat_category: "standard", expiry_date: null });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (x: Partial<ProductData>) => setP({ ...p, ...x });

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    const r = await fetch(p.id ? `/api/products/${p.id}` : "/api/products", { method: p.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
    setBusy(false);
    const j = await r.json();
    if (!r.ok) { setErr(j.error); return; }
    void refreshCatalog();
    router.push(`/inventory/${p.id ?? j.id}`); router.refresh();
  }
  async function remove() {
    if (!confirm("Remove this product from the list? Its history is kept.")) return;
    await fetch(`/api/products/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: false }) });
    void refreshCatalog(); router.push("/inventory");
  }

  return (
    <form onSubmit={save} className="card grid gap-3 p-5 sm:grid-cols-2">
      <div className="sm:col-span-2"><label className="label">Name</label><input className="input" value={p.name} onChange={(e) => set({ name: e.target.value })} required /></div>
      <div className="sm:col-span-2"><label className="label">Other names (Malayalam, Arabic, how staff say it) — comma separated</label>
        <input className="input" value={p.aliases.join(", ")} onChange={(e) => set({ aliases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="പേന, pena, قلم" /></div>
      <div><label className="label">Category</label><select className="input" value={p.category_id ?? ""} onChange={(e) => set({ category_id: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div><label className="label">Unit</label><input className="input" list="units2" value={p.unit} onChange={(e) => set({ unit: e.target.value })} />
        <datalist id="units2">{["piece", "box", "packet", "kg", "gram", "litre", "dozen", "page", "set"].map((u) => <option key={u} value={u} />)}</datalist></div>
      <div><label className="label">Purchase price (per unit, excl. VAT)</label><input type="number" step="any" className="input" value={p.purchase_price} onChange={(e) => set({ purchase_price: Number(e.target.value) })} /></div>
      <div><label className="label">Selling price (per unit)</label><input type="number" step="any" className="input" value={p.selling_price} onChange={(e) => set({ selling_price: Number(e.target.value) })} /></div>
      <div><label className="label">Low-stock alert at</label><input type="number" step="any" className="input" value={p.reorder_level} onChange={(e) => set({ reorder_level: Number(e.target.value) })} /></div>
      <div><label className="label">VAT</label><select className="input" value={p.vat_category} onChange={(e) => set({ vat_category: e.target.value as ProductData["vat_category"] })}><option value="standard">Standard rate</option><option value="zero">Zero-rated</option><option value="exempt">Exempt</option></select></div>
      <div><label className="label">SKU</label><input className="input" value={p.sku ?? ""} onChange={(e) => set({ sku: e.target.value || null })} /></div>
      <div><label className="label">Barcode</label><input className="input" value={p.barcode ?? ""} onChange={(e) => set({ barcode: e.target.value || null })} /></div>
      <div><label className="label">Expiry date (optional)</label><input type="date" className="input" value={p.expiry_date ?? ""} onChange={(e) => set({ expiry_date: e.target.value || null })} /></div>
      <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" checked={p.is_service} onChange={(e) => set({ is_service: e.target.checked })} /> Service (printing, photocopy, digital) — no stock</label>
      {!p.id && <p className="text-xs text-slate-500 sm:col-span-2">Opening stock: after saving, use “Adjust stock → Opening stock”, or just record a purchase.</p>}
      {err && <p className="text-sm text-rose-600 sm:col-span-2">{err}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save product"}</button>
        {p.id && canDelete && <button type="button" className="btn-ghost text-rose-600" onClick={remove}>Remove</button>}
      </div>
    </form>
  );
}
