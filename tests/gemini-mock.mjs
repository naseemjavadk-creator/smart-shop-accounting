// Checks the Gemini code paths against a local fake Gemini server (no real key or network needed).
// 1) start this file: it starts a fake Gemini API on :4010 and waits for the app
// 2) the app must run with GEMINI_API_KEY=test GEMINI_BASE_URL=http://localhost:4010/v1beta against an EMPTY database
// Usage: BASE=http://localhost:3000 node tests/gemini-mock.mjs
import http from "node:http";
import assert from "node:assert/strict";
const BASE = process.env.BASE ?? "http://localhost:3000";
const seen = [];
let fail429 = 0;

const reply = (res, status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const text = (t, model) => ({ candidates: [{ content: { role: "model", parts: [{ text: t }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 }, modelVersion: model });

const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const model = decodeURIComponent(req.url.match(/models\/([^:]+):/)?.[1] ?? "");
    const body = JSON.parse(b);
    seen.push({ model, key: req.headers["x-goog-api-key"], body });
    if (fail429 > 0 && model === "gemini-flash-latest") { fail429--; return reply(res, 429, { error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED" } }); }
    const parts = body.contents.flatMap((c) => c.parts);
    const sys = body.systemInstruction.parts[0].text;
    if (body.generationConfig?.responseJsonSchema && sys.includes("turn what a shop employee said")) {
      return reply(res, 200, text(JSON.stringify({ understood_text: "Sold 2 notebooks at 5 each, cash", transactions: [{ type: "sale", date: null, party_name: null, payment_method: "cash",
        items: [{ spoken_name: "nottu book", product_id: null, new_product_name: "Notebook", qty: 2, unit: "piece", unit_price: 5, line_total: null, is_service: false }],
        expense_account_id: null, description: null, amount: null, prices_include_vat: null, confidence: "high", questions: [] }] }), model));
    }
    if (body.generationConfig?.responseJsonSchema && sys.includes("read supplier bills")) {
      assert.ok(parts.some((p) => p.inlineData?.mimeType === "image/png"), "bill image sent as inlineData");
      return reply(res, 200, text("```json\n" + JSON.stringify({ supplier_name: "Al Noor Stationery", supplier_trn: null, invoice_no: "B-77", invoice_date: "2026-11-20",
        items: [{ description: "A4 paper ream", qty: 10, unit: "ream", unit_price: 12, discount: null, vat_amount: 6, line_total: 120 }],
        prices_include_vat: false, subtotal: 120, discount_total: null, vat_total: 6, total: 126, payment_method: "credit", document_kind: "purchase_bill", confidence: "high", notes: null }) + "\n```", model));
    }
    if (body.tools) {
      const fr = parts.find((p) => p.functionResponse);
      if (!fr) {
        assert.ok(body.tools[0].functionDeclarations.length >= 10, "tools declared");
        return reply(res, 200, { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "period_summary", args: { from: "2026-11-01", to: "2026-11-30" }, id: "c1" }, thoughtSignature: "sig123" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 10 }, modelVersion: model });
      }
      const prev = body.contents.find((c) => c.role === "model");
      assert.equal(prev.parts[0].thoughtSignature, "sig123", "thought signature sent back");
      assert.equal(fr.functionResponse.id, "c1");
      const sales = fr.functionResponse.response.result.sales;
      return reply(res, 200, text(`Sales this month: AED ${sales}`, model));
    }
    reply(res, 400, { error: { message: "unexpected request" } });
  });
});
await new Promise((r) => srv.listen(4010, r));

let cookie = "";
async function call(method, path, body, form) {
  const r = await fetch(BASE + path, { method, headers: form ? { cookie } : { "Content-Type": "application/json", cookie }, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  return { status: r.status, body: await r.json().catch(() => null) };
}
let n = 0; const ok = (m) => console.log(`✓ ${++n}. ${m}`);
try {
  let r = await call("POST", "/api/auth/setup", { shop_name: "Mock Shop", name: "Owner", email: "owner@mock.ae", password: "password123" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call("GET", "/api/catalog");
  assert.equal(r.body.features.ai, true); assert.equal(r.body.features.stt, true); ok("AI and server speech shown as available with only GEMINI_API_KEY");

  r = await call("POST", "/api/ai/parse", { text: "randu nottu book vittu oronninum 5 dirham" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.transactions[0].type, "sale"); assert.equal(r.body.transactions[0].total, 10);
  assert.equal(r.body.cost_usd, 0);
  const pReq = seen.at(-1);
  assert.equal(pReq.key, "test"); assert.equal(pReq.body.generationConfig.responseMimeType, "application/json");
  assert.equal(pReq.body.generationConfig.responseJsonSchema.$schema, undefined);
  ok("voice/text understanding via Gemini JSON output, cost logged as 0");

  fail429 = 1;
  r = await call("POST", "/api/ai/parse", { text: "randu nottu book vittu oronninum 5 dirham" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(seen.at(-1).model, "gemini-flash-lite-latest"); ok("free quota hit on main model → falls back to Flash-Lite");

  r = await call("POST", "/api/ai/chat", { messages: [{ role: "user", content: "ee maasam ethra sale aayi?" }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.reply, /Sales this month: AED \d/); assert.deepEqual(r.body.tools, ["period_summary"]);
  ok("chat: Gemini function call → report tool → answer from database figure");

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const fd = new FormData(); fd.append("files", new Blob([png], { type: "image/png" }), "bill.png");
  r = await call("POST", "/api/bills", null, fd);
  assert.ok(r.status < 300, JSON.stringify(r.body));
  let job;
  for (let i = 0; i < 20; i++) {
    await new Promise((s) => setTimeout(s, 500));
    const l = await call("GET", "/api/bills");
    job = (l.body.jobs ?? l.body).find?.((j) => j.status !== "queued" && j.status !== "processing");
    if (job) break;
  }
  assert.ok(job, "bill processed"); assert.equal(job.status, "review", JSON.stringify(job));
  ok("bill photo read via Gemini (inline image) → review draft");
  console.log("All Gemini mock checks passed");
} catch (e) { console.error(e); process.exitCode = 1; } finally { srv.close(); }
