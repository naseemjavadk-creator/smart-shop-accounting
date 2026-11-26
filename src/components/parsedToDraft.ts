import type { Draft, TxnKind } from "@/lib/offline/types";
import { uuid } from "@/lib/offline/idb";

export type ParsedLine = {
  spoken_name: string; product_id: string | null; product_name: string | null; new_product_name: string | null;
  qty: number; unit: string | null; unit_price: number; line_total: number; is_service: boolean;
  price_source: string; candidates: { id: string; name: string; unit: string; selling_price: number; purchase_price: number }[];
};
export type ParsedTxn = {
  type: TxnKind; date: string; party_name: string | null; payment_method: Draft["payment_method"]; items: ParsedLine[];
  expense_account_id: number | null; description: string | null; amount: number | null; prices_include_vat: boolean | null;
  confidence: "high" | "medium" | "low"; questions: string[]; total: number;
};

export function parsedToDraft(t: ParsedTxn, raw: string, source: "voice" | "text"): Draft {
  const isExpense = t.type === "expense";
  const amountOnly = t.type === "receipt" || t.type === "payment";
  return {
    type: t.type,
    txn_date: t.date,
    party_id: null,
    party_name: t.party_name ?? "",
    payment_method: amountOnly && t.payment_method === "credit" ? "cash" : t.payment_method,
    prices_include_vat: isExpense ? (t.prices_include_vat === true ? true : null) : t.prices_include_vat,
    invoice_no: "",
    notes: isExpense ? (t.description ?? t.items.map((i) => i.spoken_name).join(", ")) : "",
    expense_account_id: t.expense_account_id,
    amount: isExpense || amountOnly ? (t.amount ?? (t.total || null)) : null,
    transfer_to: null,
    adjustment_reason: null,
    vat_override: null,
    lines: isExpense || amountOnly ? [] : t.items.map((i) => ({
      key: uuid(), product_id: i.product_id, new_product_name: i.product_id ? null : i.new_product_name,
      is_service: i.is_service, description: i.product_name ?? i.new_product_name ?? i.spoken_name,
      qty: i.qty, unit: i.unit ?? "piece", unit_price: i.unit_price, discount: 0,
    })),
    source, raw_input: raw, file_id: null, ocr_job_id: null,
  };
}
