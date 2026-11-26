import { z } from "zod";

export const TXN_TYPES = [
  "purchase", "sale", "expense", "receipt", "payment",
  "sale_return", "purchase_return", "stock_adjustment", "transfer", "journal",
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const PAYMENT_METHODS = ["cash", "bank", "card", "credit"] as const;

const money = z.coerce.number().finite();

export const NewProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(30).default("piece"),
  is_service: z.boolean().default(false),
  category_id: z.number().int().nullable().optional(),
  selling_price: money.nonnegative().optional(),
  vat_category: z.enum(["standard", "zero", "exempt"]).default("standard"),
});

export const LineSchema = z.object({
  product_id: z.string().uuid().nullable().optional(),
  new_product: NewProductSchema.nullable().optional(),
  description: z.string().trim().max(300).default(""),
  qty: money,
  unit: z.string().trim().max(30).nullable().optional(),
  unit_price: money.nonnegative().default(0),
  discount: money.nonnegative().default(0),
  vat_category: z.enum(["standard", "zero", "exempt"]).nullable().optional(),
  sale_line_id: z.number().int().nullable().optional(), // for returns: the original line
});
export type LineInput = z.infer<typeof LineSchema>;

export const TxnSchema = z.object({
  type: z.enum(TXN_TYPES),
  txn_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  idempotency_key: z.string().min(8).max(100),
  device_id: z.string().max(100).nullable().optional(),
  party_id: z.string().uuid().nullable().optional(),
  party_name: z.string().trim().max(200).nullable().optional(),
  payment_method: z.enum(PAYMENT_METHODS).default("cash"),
  amount_paid: money.nonnegative().nullable().optional(), // default: full amount unless credit
  prices_include_vat: z.boolean().nullable().optional(),
  vat_override: money.nonnegative().nullable().optional(), // VAT as printed on a supplier bill
  invoice_no: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  source: z.enum(["manual", "voice", "text", "ocr", "import", "system"]).default("manual"),
  raw_input: z.string().max(5000).nullable().optional(),
  file_id: z.string().uuid().nullable().optional(),
  ocr_job_id: z.string().uuid().nullable().optional(),
  expense_account_id: z.number().int().nullable().optional(),
  related_txn_id: z.string().uuid().nullable().optional(),
  amount: money.nonnegative().nullable().optional(), // receipt / payment / transfer
  transfer_to: z.enum(["cash", "bank"]).nullable().optional(),
  adjustment_reason: z.enum(["damaged", "count", "expired", "opening", "other"]).nullable().optional(),
  lines: z.array(LineSchema).max(500).default([]),
  journal_lines: z
    .array(z.object({
      account_id: z.number().int(),
      party_id: z.string().uuid().nullable().optional(),
      debit: money.nonnegative().default(0),
      credit: money.nonnegative().default(0),
    }))
    .max(100)
    .default([]),
});
export type TxnInput = z.infer<typeof TxnSchema>;

export const TYPE_LABEL: Record<TxnType, string> = {
  purchase: "Purchase",
  sale: "Sale",
  expense: "Expense",
  receipt: "Payment received",
  payment: "Payment to supplier",
  sale_return: "Sales return",
  purchase_return: "Purchase return",
  stock_adjustment: "Stock adjustment",
  transfer: "Cash / bank transfer",
  journal: "Journal entry",
};
