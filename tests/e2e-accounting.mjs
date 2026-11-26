// End-to-end accounting check against a running server with an EMPTY database.
// Usage: BASE=http://localhost:3000 node tests/e2e-accounting.mjs
import assert from "node:assert/strict";
const BASE = process.env.BASE ?? "http://localhost:3000";
let cookie = "";
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : await r.text(), headers: r.headers };
}
const key = () => "test-" + crypto.randomUUID();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
let n = 0; const ok = (m) => console.log(`✓ ${++n}. ${m}`);

let r = await call("POST", "/api/auth/setup", { shop_name: "Test Shop", name: "Owner", email: "owner@test.ae", password: "password123" });
assert.equal(r.status, 200, JSON.stringify(r.body)); ok("owner setup");
r = await call("POST", "/api/auth/setup", { shop_name: "X", name: "X", email: "owner@test.ae", password: "password123" });
assert.equal(r.status, 409); ok("same email cannot sign up twice");

// purchase 20 boxes pens for 100 (excl VAT) on credit from supplier → new product, AP 105
const pur = { type: "purchase", txn_date: today, idempotency_key: key(), party_name: "Al Noor Stationery", payment_method: "credit", invoice_no: "INV-1",
  lines: [{ new_product: { name: "Pen box", unit: "box" }, description: "Pen box", qty: 20, unit_price: 5 }] };
r = await call("POST", "/api/transactions", pur);
assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.total, 105); ok("credit purchase posted, total 105 incl. 5% VAT");
r = await call("POST", "/api/transactions", pur);
assert.equal(r.body.duplicate, true); ok("same idempotency key → no duplicate");
r = await call("POST", "/api/transactions", { ...pur, idempotency_key: key() });
assert.equal(r.status, 409); ok("same supplier invoice number → blocked as duplicate bill");

// cash sale 5 boxes at 10 each incl VAT (retail default) → net 47.62, vat 2.38, COGS 25
const cat = (await call("GET", "/api/catalog")).body;
const pen = cat.products.find((p) => p.name === "Pen box");
assert.equal(pen.qty_on_hand, 20); ok("stock = 20 after purchase");
r = await call("POST", "/api/transactions", { type: "sale", txn_date: today, idempotency_key: key(), payment_method: "cash", lines: [{ product_id: pen.id, qty: 5, unit_price: 10 }] });
assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.total, 50); ok("cash sale 50 incl. VAT");

// expense electricity 100 no VAT, cash
const elec = cat.expenseAccounts.find((a) => a.name === "Electricity");
r = await call("POST", "/api/transactions", { type: "expense", txn_date: today, idempotency_key: key(), payment_method: "cash", expense_account_id: elec.id, prices_include_vat: true,
  lines: [{ description: "DEWA", qty: 1, unit_price: 100, vat_category: "exempt" }] });
assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.total, 100); ok("expense 100 (no VAT)");

// credit sale needs customer
r = await call("POST", "/api/transactions", { type: "sale", txn_date: today, idempotency_key: key(), payment_method: "credit", lines: [{ product_id: pen.id, qty: 1, unit_price: 10 }] });
assert.equal(r.status, 400); ok("credit sale without customer rejected");
r = await call("POST", "/api/transactions", { type: "sale", txn_date: today, idempotency_key: key(), payment_method: "credit", party_name: "Rahim", lines: [{ product_id: pen.id, qty: 2, unit_price: 10.5 }] });
assert.equal(r.status, 201); ok("credit sale to Rahim 21");
r = await call("POST", "/api/transactions", { type: "receipt", txn_date: today, idempotency_key: key(), payment_method: "cash", party_name: "Rahim", amount: 11 });
assert.equal(r.status, 201, JSON.stringify(r.body)); ok("Rahim paid 11");
r = await call("POST", "/api/transactions", { type: "payment", txn_date: today, idempotency_key: key(), payment_method: "bank", party_name: "Al Noor Stationery", amount: 50 });
assert.equal(r.status, 201); ok("paid supplier 50 by bank");

// service sale (photocopy) no stock
r = await call("POST", "/api/transactions", { type: "sale", txn_date: today, idempotency_key: key(), payment_method: "cash", lines: [{ new_product: { name: "Photocopy A4", unit: "page", is_service: true }, qty: 30, unit_price: 0.5 }] });
assert.equal(r.status, 201); ok("photocopy service sale 15");

// offline batch sync with duplicates
const off = { type: "sale", txn_date: today, idempotency_key: key(), payment_method: "card", lines: [{ product_id: pen.id, qty: 1, unit_price: 10 }] };
r = await call("POST", "/api/sync", { entries: [off, off, { type: "sale", txn_date: today, idempotency_key: key(), lines: [] }] });
assert.equal(r.body.results[0].ok, true); assert.equal(r.body.results[1].duplicate, true); assert.equal(r.body.results[2].ok, false); assert.equal(r.body.results[2].retry, false);
ok("offline batch: saved once, duplicate ignored, bad entry returned for fixing");

// void the card sale → stock back
const cat2 = (await call("GET", "/api/catalog")).body;
assert.equal(cat2.products.find((p) => p.id === pen.id).qty_on_hand, 12); ok("stock = 20 − 5 − 2 − 1 = 12");
r = await call("POST", `/api/transactions/${r.body.results[0].id}/void`, { reason: "test void" });
assert.equal(r.status, 200); ok("void card sale");
const cat3 = (await call("GET", "/api/catalog")).body;
assert.equal(cat3.products.find((p) => p.id === pen.id).qty_on_hand, 13); ok("stock back to 13 after void");

// stock adjustment: 1 damaged
r = await call("POST", "/api/transactions", { type: "stock_adjustment", txn_date: today, idempotency_key: key(), adjustment_reason: "damaged", lines: [{ product_id: pen.id, qty: -1 }] });
assert.equal(r.status, 201, JSON.stringify(r.body)); ok("1 box damaged");

console.log("\nAll API checks passed. Ledger checks next (via SQL).");
