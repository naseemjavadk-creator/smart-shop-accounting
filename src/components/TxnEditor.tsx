"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Plus, Trash2, Check, AlertTriangle, Sparkles } from "lucide-react";
import type { Catalog, Draft, DraftLine, TxnKind, CatalogProduct } from "@/lib/offline/types";
import { draftTotals, draftToPayload } from "@/lib/offline/calc";
import { uuid } from "@/lib/offline/idb";
import { saveEntry } from "@/lib/offline/sync";

export const KIND_LABEL: Record<TxnKind, string> = {
  sale: "Sale", purchase: "Purchase", expense: "Expense", receipt: "Customer paid me", payment: "I paid supplier",
  sale_return: "Customer returned goods", purchase_return: "Returned to supplier", stock_adjustment: "Stock correction", transfer: "Cash ↔ Bank",
};

export function todayLocal() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function emptyLine(): DraftLine {
  return { key: uuid(), product_id: null, new_product_name: null, is_service: false, description: "", qty: 1, unit: "piece", unit_price: 0, discount: 0 };
}

export function emptyDraft(type: TxnKind): Draft {
  return {
    type, txn_date: todayLocal(), party_id: null, party_name: "", payment_method: "cash", prices_include_vat: null,
    invoice_no: "", notes: "", expense_account_id: null, amount: null, transfer_to: type === "transfer" ? "bank" : null,
    adjustment_reason: type === "stock_adjustment" ? "count" : null, vat_override: null,
    lines: ["receipt", "payment", "transfer", "expense"].includes(type) ? [] : [emptyLine()],
    source: "manual", raw_input: null, file_id: null, ocr_job_id: null,
  };
}

const fmt = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function partyKind(t: TxnKind): "supplier" | "customer" | null {
  if (["sale", "sale_return", "receipt"].includes(t)) return "customer";
  if (["purchase", "purchase_return", "payment", "expense"].includes(t)) return "supplier";
  return null;
}

function matchProducts(cat: Catalog | null, text: string): CatalogProduct[] {
  const s = text.trim().toLowerCase();
  if (!cat || !s) return [];
  return cat.products
    .map((p) => {
      const names = [p.name, ...(p.aliases ?? []), p.sku ?? "", p.barcode ?? ""].map((x) => x.toLowerCase());
      const score = names.some((n) => n === s) ? 3 : names.some((n) => n.startsWith(s)) ? 2 : names.some((n) => n.includes(s)) ? 1 : 0;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, 6)
    .map((x) => x.p);
}

function ProductCell({ line, cat, type, onChange }: { line: DraftLine; cat: Catalog | null; type: TxnKind; onChange: (l: Partial<DraftLine>) => void }) {
  const product = line.product_id ? cat?.products.find((p) => p.id === line.product_id) : null;
  const [text, setText] = useState(product?.name ?? line.new_product_name ?? line.description ?? "");
  const [focus, setFocus] = useState(false);
  const sugg = matchProducts(cat, text);
  const isSaleSide = type === "sale" || type === "sale_return";

  function pick(p: CatalogProduct) {
    setText(p.name);
    setFocus(false);
    onChange({
      product_id: p.id, new_product_name: null, description: p.name, unit: p.unit, is_service: p.is_service,
      unit_price: line.unit_price || (isSaleSide ? p.selling_price : p.purchase_price) || 0,
    });
  }
  return (
    <div className="relative">
      <input
        className="input" placeholder="Product or service" value={text}
        onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
        onChange={(e) => {
          setText(e.target.value);
          onChange({ product_id: null, new_product_name: e.target.value, description: e.target.value });
        }}
      />
      {focus && sugg.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {sugg.map((p) => (
            <button type="button" key={p.id} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700">
              <span>{p.name}</span>
              <span className="text-xs text-slate-500">{p.is_service ? "service" : `${p.qty_on_hand} ${p.unit}`} · AED {isSaleSide ? p.selling_price : p.purchase_price}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-1 flex items-center gap-2 text-xs">
        {product ? (
          <span className="text-emerald-600">✓ {product.is_service ? "Service" : `In stock: ${product.qty_on_hand} ${product.unit}`}</span>
        ) : text.trim() ? (
          <>
            <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">New product</span>
            <label className="flex items-center gap-1 text-slate-500">
              <input type="checkbox" checked={line.is_service} onChange={(e) => onChange({ is_service: e.target.checked })} /> service (no stock)
            </label>
          </>
        ) : null}
      </div>
    </div>
  );
}

export type SavedInfo = { key: string; summary: string; total: number };

const LINE_TYPES = ["sale", "purchase", "sale_return", "purchase_return", "stock_adjustment"];
const AMOUNT_TYPES = ["receipt", "payment", "transfer"];

/** What is still missing in a draft before it can be saved (null = ready). Used by the form and by "Save all". */
export function checkDraft(d: Draft, cat: Catalog | null): string | null {
  const totals = draftTotals(d, cat);
  const pk = partyKind(d.type);
  const hasLines = LINE_TYPES.includes(d.type);
  const amountOnly = AMOUNT_TYPES.includes(d.type);
  if (!d.txn_date) return "Choose the date";
  if (hasLines) {
    if (!d.lines.length) return "Add at least one item";
    for (const l of d.lines) {
      if (!l.product_id && !(l.new_product_name || "").trim()) return "Every line needs a product";
      if (!(l.qty > 0)) return "Quantity must be more than 0";
      if (d.type !== "stock_adjustment" && !(l.unit_price >= 0)) return "Check the prices";
    }
    if (d.type !== "stock_adjustment" && totals.total <= 0) return "Total is 0. Enter the price.";
  }
  if (d.type === "expense" && !(d.amount && d.amount > 0)) return "Enter the amount";
  if (amountOnly && !(d.amount && d.amount > 0)) return "Enter the amount";
  if ((d.type === "receipt" || d.type === "payment") && !d.party_id && !d.party_name.trim()) return pk === "customer" ? "Choose the customer" : "Choose the supplier";
  if (d.payment_method === "credit" && !d.party_id && !d.party_name.trim()) return pk === "customer" ? "Credit sale needs the customer name" : "Credit purchase needs the supplier name";
  return null;
}

/** Total shown to the user for a draft. */
export function draftTotal(d: Draft, cat: Catalog | null) {
  return d.type === "expense" || AMOUNT_TYPES.includes(d.type) ? (d.amount ?? 0) : draftTotals(d, cat).total;
}

/** Save a checked draft on this phone (synced to the cloud as soon as possible). */
export async function saveDraft(d: Draft, cat: Catalog | null): Promise<SavedInfo> {
  // expenses: the amount said is what was paid; VAT only when the bill shows VAT
  const draft: Draft = d.type === "expense"
    ? { ...d, prices_include_vat: true, lines: [{ ...emptyLine(), description: d.notes || cat?.expenseAccounts.find((a) => a.id === d.expense_account_id)?.name || "Expense",
        qty: 1, unit_price: d.amount ?? 0, unit: "", vat_category: d.prices_include_vat === true ? "standard" : "exempt" }] }
    : d;
  const payload = draftToPayload(draft);
  const what = d.type === "expense"
    ? `${cat?.expenseAccounts.find((a) => a.id === d.expense_account_id)?.name ?? "Expense"}${d.notes ? ": " + d.notes : ""}`
    : AMOUNT_TYPES.includes(d.type) ? `${KIND_LABEL[d.type]}${d.party_name ? " · " + d.party_name : ""}`
    : d.lines.map((l) => `${l.description || l.new_product_name} × ${l.qty}`).join(", ");
  const total = draftTotal(d, cat);
  const item = await saveEntry(payload, `${KIND_LABEL[d.type]}: ${what}`, total);
  return { key: item.key, summary: item.summary, total };
}

export function TxnEditor({
  initial, cat, fixedType, onSaved, onCancel, onChange, compact, saveLabel,
}: {
  initial: Draft; cat: Catalog | null; fixedType?: boolean; onSaved?: (s: SavedInfo) => void; onCancel?: () => void;
  /** told about every edit, so a list can "save all" with the edited values */
  onChange?: (d: Draft) => void; compact?: boolean; saveLabel?: string;
}) {
  const [d, setD] = useState<Draft>(initial);
  const changeRef = useRef(onChange);
  useEffect(() => { changeRef.current = onChange; });
  useEffect(() => { changeRef.current?.(d); }, [d]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  // simple by default: date (today), bill number and VAT override sit under "More options" unless already filled
  const [moreOpts, setMoreOpts] = useState(false);
  const showDate = moreOpts || d.txn_date !== todayLocal();
  const showInvoice = moreOpts || !!d.invoice_no;
  const showVatOverride = moreOpts || d.vat_override != null;
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const setLine = (key: string, p: Partial<DraftLine>) => setD((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) }));
  const totals = useMemo(() => draftTotals(d, cat), [d, cat]);
  const pk = partyKind(d.type);
  const parties = cat?.parties.filter((p) => p.kind === pk) ?? [];
  const hasLines = ["sale", "purchase", "sale_return", "purchase_return", "stock_adjustment"].includes(d.type);
  const amountOnly = ["receipt", "payment", "transfer"].includes(d.type);
  const owner = cat?.user.role === "owner";

  async function save() {
    const v = checkDraft(d, cat);
    if (v) { setErr(v); return; }
    setErr(""); setSaving(true);
    const info = await saveDraft(d, cat);
    setSaving(false);
    onSaved?.(info);
  }

  const partyField = pk && (
    <div>
      <label className="label">{pk === "customer" ? "Customer" : "Supplier"} {d.payment_method === "credit" || amountOnly ? "" : "(optional)"}</label>
      <input className="input" list={`parties-${pk}`} value={d.party_name}
        onChange={(e) => {
          const m = parties.find((p) => p.name.toLowerCase() === e.target.value.trim().toLowerCase());
          set({ party_name: e.target.value, party_id: m?.id ?? null });
        }} placeholder={pk === "customer" ? "Walk-in customer" : "Supplier name"} />
      <datalist id={`parties-${pk}`}>{parties.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      {d.party_name.trim() && !d.party_id && <div className="mt-1 text-xs text-amber-600">New {pk} will be added</div>}
    </div>
  );

  return (
    <div className={clsx("space-y-4", compact && "text-sm")}>
      {!fixedType && (
        <div className="flex flex-wrap gap-1.5">
          {(["sale", "purchase", "expense", "receipt", "payment", "sale_return", "purchase_return"] as TxnKind[]).map((t) => (
            <button key={t} type="button" onClick={() => set({ type: t, lines: t === "expense" || ["receipt", "payment"].includes(t) ? [] : d.lines.length ? d.lines : [emptyLine()] })}
              className={clsx("chip px-3 py-1.5 text-sm", d.type === t ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300")}>
              {KIND_LABEL[t]}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {showDate && (
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={d.txn_date} onChange={(e) => set({ txn_date: e.target.value })} />
          </div>
        )}
        {d.type !== "stock_adjustment" && d.type !== "transfer" && partyField}
        {showInvoice && (d.type === "purchase" || d.type === "expense") && (
          <div>
            <label className="label">Bill / invoice no. (optional)</label>
            <input className="input" value={d.invoice_no} onChange={(e) => set({ invoice_no: e.target.value })} />
          </div>
        )}
        {d.type === "stock_adjustment" && (
          <div>
            <label className="label">Reason</label>
            <select className="input" value={d.adjustment_reason ?? "count"} onChange={(e) => set({ adjustment_reason: e.target.value as Draft["adjustment_reason"] })}>
              <option value="count">Stock count correction (+ / −)</option>
              <option value="damaged">Damaged (remove)</option>
              <option value="expired">Expired (remove)</option>
              {owner && <option value="opening">Opening stock (add with cost)</option>}
              <option value="other">Other</option>
            </select>
          </div>
        )}
      </div>

      {d.type === "expense" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Expense type</label>
            <select className="input" value={d.expense_account_id ?? ""} onChange={(e) => set({ expense_account_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Choose…</option>
              {cat?.expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Amount (AED)</label>
            <input type="number" inputMode="decimal" step="0.01" className="input text-lg font-semibold" value={d.amount ?? ""} onChange={(e) => set({ amount: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Details</label>
            <input className="input" value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. November DEWA bill" />
          </div>
        </div>
      )}

      {amountOnly && (
        <div className="grid gap-3 sm:grid-cols-3">
          {d.type === "transfer" ? (
            <div>
              <label className="label">Move money</label>
              <select className="input" value={d.payment_method === "cash" ? "cash-bank" : "bank-cash"}
                onChange={(e) => set(e.target.value === "cash-bank" ? { payment_method: "cash", transfer_to: "bank" } : { payment_method: "bank", transfer_to: "cash" })}>
                <option value="cash-bank">Cash → Bank (deposit)</option>
                <option value="bank-cash">Bank → Cash (withdrawal)</option>
              </select>
            </div>
          ) : null}
          <div>
            <label className="label">Amount (AED)</label>
            <input type="number" inputMode="decimal" step="0.01" className="input text-lg font-semibold" value={d.amount ?? ""} onChange={(e) => set({ amount: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Note</label>
            <input className="input" value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>
        </div>
      )}

      {hasLines && (
        <div className="space-y-3">
          {d.lines.map((l, i) => {
            const lineTotal = r2(l.qty * l.unit_price - (l.discount || 0));
            return (
              <div key={l.key} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="grid gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <label className="label">Item {i + 1}</label>
                    <ProductCell line={l} cat={cat} type={d.type} onChange={(p) => setLine(l.key, p)} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label">Qty</label>
                    <input type="number" inputMode="decimal" step="any" className="input" value={l.qty} onChange={(e) => setLine(l.key, { qty: Number(e.target.value) })} />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="label">Unit</label>
                    <input className="input px-2" value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value })} list="units" />
                  </div>
                  {d.type === "stock_adjustment" ? (
                    d.adjustment_reason === "opening" && (
                      <div className="sm:col-span-2">
                        <label className="label">Cost / unit</label>
                        <input type="number" inputMode="decimal" step="any" className="input" value={l.unit_price} onChange={(e) => setLine(l.key, { unit_price: Number(e.target.value) })} />
                      </div>
                    )
                  ) : (
                    <>
                      <div className="sm:col-span-2">
                        <label className="label">Price / unit</label>
                        <input type="number" inputMode="decimal" step="any" className="input" value={l.unit_price} onChange={(e) => setLine(l.key, { unit_price: Number(e.target.value) })} />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="label">Line total</label>
                        <input type="number" inputMode="decimal" step="0.01" className="input font-semibold" value={lineTotal}
                          onChange={(e) => { const t = Number(e.target.value); setLine(l.key, { unit_price: l.qty > 0 ? Math.round(((t + (l.discount || 0)) / l.qty) * 10000) / 10000 : t }); }} />
                      </div>
                    </>
                  )}
                </div>
                {d.lines.length > 1 && (
                  <button type="button" className="btn-ghost mt-2 px-2 py-1 text-xs text-rose-600" onClick={() => set({ lines: d.lines.filter((x) => x.key !== l.key) })}>
                    <Trash2 size={14} /> Remove
                  </button>
                )}
              </div>
            );
          })}
          <datalist id="units">{["piece", "box", "packet", "kg", "gram", "litre", "dozen", "page", "set", "roll", "pair", "bundle"].map((u) => <option key={u} value={u} />)}</datalist>
          <button type="button" className="btn-secondary" onClick={() => set({ lines: [...d.lines, emptyLine()] })}><Plus size={16} /> Add item</button>
        </div>
      )}

      {d.type !== "stock_adjustment" && d.type !== "transfer" && (
        <div>
          <label className="label">Payment</label>
          <div className="flex flex-wrap gap-1.5">
            {(amountOnly ? ["cash", "bank"] : ["cash", "card", "bank", "credit"]).map((m) => (
              <button key={m} type="button" onClick={() => set({ payment_method: m as Draft["payment_method"] })}
                className={clsx("chip px-4 py-2 text-sm capitalize", d.payment_method === m ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300")}>
                {m === "credit" ? "Pay later" : m}
              </button>
            ))}
          </div>
        </div>
      )}

      {(hasLines || d.type === "expense") && d.type !== "stock_adjustment" && cat?.vat.registered && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {d.type === "expense" ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={d.prices_include_vat === true} onChange={(e) => set({ prices_include_vat: e.target.checked })} /> Amount includes VAT ({cat.vat.standard_rate}%) — bill has a TRN
            </label>
          ) : (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={totals.include} onChange={(e) => set({ prices_include_vat: e.target.checked })} /> Prices include VAT ({cat.vat.standard_rate}%)
            </label>
          )}
          {showVatOverride && (d.type === "purchase" || d.type === "expense") && (
            <label className="flex items-center gap-2">VAT on bill
              <input type="number" step="0.01" className="input w-28 py-1.5" placeholder="auto" value={d.vat_override ?? ""} onChange={(e) => set({ vat_override: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
          )}
        </div>
      )}

      {!compact && hasLines && (
        <div>
          <label className="label">Note (optional)</label>
          <input className="input" value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
      )}

      {!moreOpts && d.type !== "transfer" && (
        <button type="button" className="text-sm text-brand-600" onClick={() => setMoreOpts(true)}>
          + More options ({d.type === "purchase" || d.type === "expense" ? "date, bill no., VAT amount" : "date"})
        </button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
        <div className="text-sm">
          {d.type === "expense" ? (
            <div className="text-lg font-bold">Grand total AED {fmt(d.amount ?? 0)}</div>
          ) : amountOnly ? (
            <div className="text-lg font-bold">AED {fmt(d.amount ?? 0)}</div>
          ) : d.type === "stock_adjustment" ? (
            <div className="text-slate-500">Stock value is calculated at average cost</div>
          ) : (
            <>
              <div className="grid min-w-56 grid-cols-[auto_auto] gap-x-6 gap-y-0.5">
                <span className="text-slate-500">Gross amount</span><span className="text-right tabular-nums">{fmt(totals.net)}</span>
                <span className="text-slate-500">VAT</span><span className="text-right tabular-nums">{fmt(totals.vat)}</span>
                <span className="col-span-2 my-0.5 border-t border-slate-200 dark:border-slate-700" />
                <span className="text-lg font-bold">Grand total</span>
                <span className="text-right text-lg font-bold tabular-nums">AED {fmt(totals.total)}</span>
              </div>
            </>
          )}
        </div>
        <div className="flex gap-2">
          {onCancel && <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>}
          <button type="button" className="btn-primary px-6 py-3 text-base" onClick={save} disabled={saving}>
            <Check size={18} /> {saving ? "Saving…" : saveLabel ?? "Confirm & save"}
          </button>
        </div>
      </div>
      {err && <p className="flex items-center gap-1 text-sm text-rose-600"><AlertTriangle size={14} /> {err}</p>}
      {d.source !== "manual" && d.raw_input && (
        <p className="flex items-start gap-1 text-xs text-slate-500"><Sparkles size={12} className="mt-0.5 shrink-0" /> From: “{d.raw_input}”</p>
      )}
    </div>
  );
}
