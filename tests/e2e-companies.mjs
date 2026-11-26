// Company isolation check: two companies sign up and must never see or change each other's data.
// Run against a server whose database role is NOT a superuser (superusers skip row-level security).
// Usage: BASE=http://localhost:3000 node tests/e2e-companies.mjs
import assert from "node:assert/strict";
const BASE = process.env.BASE ?? "http://localhost:3000";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
const stamp = Date.now();
let n = 0; const ok = (m) => console.log(`✓ ${++n}. ${m}`);

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const ct = r.headers.get("content-type") ?? "";
    return { status: r.status, body: ct.includes("json") ? await r.json() : await r.text() };
  };
}
const A = client(), B = client(), anon = client();
const sale = (price, name) => ({ type: "sale", txn_date: today, idempotency_key: crypto.randomUUID(), payment_method: "cash",
  lines: [{ new_product: { name, unit: "piece" }, description: name, qty: 1, unit_price: price }] });

let r = await A("POST", "/api/auth/setup", { shop_name: "Alpha Stores", trn: "100000000000003", address: "Dubai", name: "Anna", email: `a${stamp}@alpha.ae`, password: "password123", vat_registered: true, vat_rate: 5 });
assert.equal(r.status, 200, JSON.stringify(r.body));
r = await B("POST", "/api/auth/setup", { shop_name: "Beta Mart", name: "Ben", email: `b${stamp}@beta.ae`, password: "password123", vat_registered: false });
assert.equal(r.status, 200, JSON.stringify(r.body)); ok("two companies signed up");

r = await A("POST", "/api/transactions", sale(105, "Pen"));
assert.equal(r.status, 201, JSON.stringify(r.body)); const aTxn = r.body;
r = await B("POST", "/api/transactions", sale(50, "Pen"));
assert.equal(r.status, 201, JSON.stringify(r.body)); const bTxn = r.body;
assert.equal(aTxn.ref_no, "T000001"); assert.equal(bTxn.ref_no, "T000001");
ok("each company numbers its own entries from T000001 and can use the same product name");

r = await B("GET", `/api/transactions/${aTxn.id}`);
assert.ok([403, 404].includes(r.status), `B read A's txn: ${r.status}`); ok("B cannot open A's entry by id");
r = await B("POST", `/api/transactions/${aTxn.id}/void`, { reason: "attack test" });
assert.ok([403, 404].includes(r.status), `B voided A's txn: ${r.status}`);
r = await A("GET", `/api/transactions/${aTxn.id}`);
assert.equal(r.body.status ?? r.body.transaction?.status ?? "posted", "posted"); ok("B cannot delete A's entry");

const ca = (await A("GET", "/api/catalog")).body, cb = (await B("GET", "/api/catalog")).body;
assert.deepEqual(ca.products.map((p) => p.name), ["Pen"]); assert.deepEqual(cb.products.map((p) => p.name), ["Pen"]);
assert.notEqual(ca.products[0].id, cb.products[0].id);
assert.equal(ca.vat.registered, true); assert.equal(cb.vat.registered, false); ok("catalogs and VAT settings are separate");

r = await B("GET", `/api/products/${ca.products[0].id}`);
assert.ok([403, 404].includes(r.status), `B read A's product: ${r.status}`); ok("B cannot read A's product");

const la = (await A("GET", `/api/transactions?from=${today}&to=${today}`)).body;
const lb = (await B("GET", `/api/transactions?from=${today}&to=${today}`)).body;
const rows = (x) => x.transactions ?? x.rows ?? x;
assert.equal(rows(la).length, 1); assert.equal(rows(lb).length, 1); ok("transaction lists only show own entries");

r = await B("GET", "/api/backup");
assert.ok(!JSON.stringify(r.body).includes("Alpha Stores"), "backup leaked other company"); ok("B's backup has none of A's data");

r = await B("GET", `/api/files/00000000-0000-0000-0000-000000000000`);
assert.ok(r.status >= 400); ok("unknown file id refused");

r = await anon("GET", "/api/catalog");
assert.equal(r.status, 401); ok("no session → nothing");

r = await A("POST", "/api/users", { name: "Emp", email: `b${stamp}@beta.ae`, password: "password123", role: "employee" });
assert.ok(r.status >= 400, "reusing another company's email must fail"); ok("an email belongs to one company only");

const s = await A("PATCH", "/api/settings", { shop: { name: "Alpha Stores LLC", trn: "100000000000003", address: "Deira, Dubai", phone: "04", email: "info@alpha.ae" } });
assert.equal(s.status, 200, JSON.stringify(s.body));
r = await B("GET", "/api/catalog"); assert.notEqual(r.body.shop?.name, "Alpha Stores LLC"); ok("settings changes stay inside the company");

console.log("\nAll company isolation checks passed");
