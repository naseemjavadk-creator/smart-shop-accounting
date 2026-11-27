import { emptyDraft } from "./TxnEditor";
import { uuid } from "@/lib/offline/idb";
import type { Draft } from "@/lib/offline/types";

export type BillDraft = {
  supplier_id: string | null; supplier_name: string | null; invoice_no: string | null; date: string; prices_include_vat: boolean;
  vat_total: number | null; total: number | null; payment_method: Draft["payment_method"];
  items: { description: string; qty: number; unit: string; unit_price: number; discount: number; product_id: string | null; product_name: string | null }[];
  duplicate: { id: string; ref_no: string } | null; document_kind: string; confidence: string; notes: string | null;
};

/** Turn what the AI read from a bill into an entry the owner can check and save. */
export function billToEntry(d: BillDraft, job: { id: string; file_id: string }): Draft {
  return {
    ...emptyDraft("purchase"),
    txn_date: d.date, party_id: d.supplier_id, party_name: d.supplier_name ?? "", invoice_no: d.invoice_no ?? "",
    payment_method: d.payment_method, prices_include_vat: d.prices_include_vat, vat_override: d.vat_total,
    source: "ocr", file_id: job.file_id, ocr_job_id: job.id, raw_input: null,
    lines: d.items.map((i) => ({ key: uuid(), product_id: i.product_id, new_product_name: i.product_id ? null : i.description,
      is_service: false, description: i.product_name ?? i.description, qty: i.qty, unit: i.unit, unit_price: i.unit_price, discount: i.discount })),
  };
}
