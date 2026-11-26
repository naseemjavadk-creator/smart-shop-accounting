import type { Catalog, Draft } from "./types";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Same arithmetic as the server, for the live preview on the confirm screen. */
export function draftTotals(d: Draft, cat: Catalog | null) {
  const vat = cat?.vat ?? { registered: true, standard_rate: 5, sales_prices_include_vat: true, purchase_prices_include_vat: false };
  const isSaleSide = d.type === "sale" || d.type === "sale_return";
  const include = d.prices_include_vat ?? (isSaleSide ? vat.sales_prices_include_vat : vat.purchase_prices_include_vat);
  if (["receipt", "payment", "transfer"].includes(d.type)) return { net: d.amount ?? 0, vat: 0, total: d.amount ?? 0, include };
  let net = 0, v = 0;
  for (const l of d.lines) {
    const p = l.product_id ? cat?.products.find((x) => x.id === l.product_id) : null;
    const rate = d.type === "stock_adjustment" ? 0 : vat.registered && (p?.vat_category ?? "standard") === "standard" ? vat.standard_rate : 0;
    const gross = r2(Math.abs(l.qty) * l.unit_price - (l.discount || 0));
    if (include) { const n = r2(gross / (1 + rate / 100)); net += n; v += r2(gross - n); }
    else { net += gross; v += r2((gross * rate) / 100); }
  }
  if ((d.type === "purchase" || d.type === "expense") && d.vat_override != null) {
    const diff = d.vat_override - v;
    v = d.vat_override;
    if (include) net -= diff;
  }
  return { net: r2(net), vat: r2(v), total: r2(net + v), include };
}

export function draftToPayload(d: Draft): Record<string, unknown> {
  return {
    type: d.type,
    txn_date: d.txn_date,
    party_id: d.party_id,
    party_name: d.party_id ? null : d.party_name.trim() || null,
    payment_method: d.payment_method,
    prices_include_vat: d.prices_include_vat,
    invoice_no: d.invoice_no.trim() || null,
    notes: d.notes.trim() || null,
    expense_account_id: d.expense_account_id,
    amount: d.amount,
    transfer_to: d.transfer_to,
    adjustment_reason: d.adjustment_reason,
    vat_override: d.vat_override,
    source: d.source,
    raw_input: d.raw_input,
    file_id: d.file_id,
    ocr_job_id: d.ocr_job_id,
    lines: d.type === "expense" && d.lines.length === 0 ? [] : d.lines.map((l) => ({
      product_id: d.type === "expense" ? null : l.product_id,
      new_product: d.type !== "expense" && !l.product_id && l.new_product_name
        ? { name: l.new_product_name.trim(), unit: l.unit || "piece", is_service: l.is_service } : null,
      description: l.description || l.new_product_name || "",
      qty: d.type === "stock_adjustment" && (d.adjustment_reason === "damaged" || d.adjustment_reason === "expired") ? -Math.abs(l.qty) : l.qty,
      unit: l.unit || null,
      unit_price: l.unit_price,
      discount: l.discount || 0,
      vat_category: l.vat_category ?? null,
    })),
  };
}
