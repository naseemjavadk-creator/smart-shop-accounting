export type CatalogProduct = {
  id: string; name: string; aliases: string[]; unit: string; is_service: boolean; selling_price: number; purchase_price: number;
  qty_on_hand: number; reorder_level: number; vat_category: "standard" | "zero" | "exempt"; category_id: number | null;
  sku: string | null; barcode: string | null;
};
export type CatalogParty = { id: string; kind: "supplier" | "customer"; name: string; phone: string | null };
export type Catalog = {
  user: { id: string; name: string; role: "owner" | "employee"; can_purchases: boolean; can_sales: boolean; can_expenses: boolean; can_reports: boolean; can_void?: boolean };
  products: CatalogProduct[];
  parties: CatalogParty[];
  expenseAccounts: { id: number; code: string; name: string }[];
  categories: { id: number; name: string }[];
  vat: { registered: boolean; standard_rate: number; sales_prices_include_vat: boolean; purchase_prices_include_vat: boolean };
  features: { ai: boolean; stt: boolean };
  fetched_at: string;
};

export type DraftLine = {
  key: string;
  product_id: string | null;
  new_product_name: string | null;
  is_service: boolean;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  discount: number;
  vat_category?: "standard" | "zero" | "exempt" | null;
};

export type TxnKind = "purchase" | "sale" | "expense" | "receipt" | "payment" | "sale_return" | "purchase_return" | "stock_adjustment" | "transfer";

export type Draft = {
  type: TxnKind;
  txn_date: string;
  party_id: string | null;
  party_name: string;
  payment_method: "cash" | "bank" | "card" | "credit";
  prices_include_vat: boolean | null;
  invoice_no: string;
  notes: string;
  expense_account_id: number | null;
  amount: number | null;
  transfer_to: "cash" | "bank" | null;
  adjustment_reason: "damaged" | "count" | "expired" | "opening" | "other" | null;
  vat_override: number | null;
  lines: DraftLine[];
  source: "manual" | "voice" | "text" | "ocr";
  raw_input: string | null;
  file_id: string | null;
  ocr_job_id: string | null;
};

export type OutboxItem = {
  key: string; // idempotency key
  payload: Record<string, unknown>;
  summary: string;
  total: number;
  status: "pending" | "syncing" | "synced" | "error";
  error?: string;
  ref_no?: string;
  warnings?: string[];
  created_at: string;
  synced_at?: string;
  attempts: number;
};

export type PendingItem = {
  id: string;
  kind: "voice" | "bill";
  text?: string;
  blob?: Blob;
  filename?: string;
  created_at: string;
};
