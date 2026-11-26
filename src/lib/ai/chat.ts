import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { claude, MODELS, FALLBACK, logUsage, assertBudget } from "./claude";
import * as R from "../reports";
import { num } from "../db";
import { addDays, isISODate, todayISO } from "../dates";
import { HttpError } from "../auth";

type Tool = Anthropic.Beta.BetaTool;

const range = {
  from: { type: "string", description: "Start date YYYY-MM-DD (inclusive)" },
  to: { type: "string", description: "End date YYYY-MM-DD (inclusive)" },
} as const;

const TOOLS: Tool[] = [
  { name: "period_summary", description: "Sales, returns, cost of goods sold, gross profit, purchases, expenses, net profit and VAT for a date range.",
    input_schema: { type: "object", properties: { ...range }, required: ["from", "to"], additionalProperties: false } },
  { name: "balances", description: "Cash in hand, bank balance, customer receivables, supplier payables, inventory value and VAT payable as of a date.",
    input_schema: { type: "object", properties: { as_of: { type: "string" } }, required: ["as_of"], additionalProperties: false } },
  { name: "product_lookup", description: "Find products by name (any language/spelling) and get stock, selling price, last purchase price, average cost, and quantity/amount sold and purchased in a date range.",
    input_schema: { type: "object", properties: { query: { type: "string" }, ...range }, required: ["query", "from", "to"], additionalProperties: false } },
  { name: "low_stock", description: "Products at or below their reorder level.",
    input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "stock_list", description: "All stock items with quantity, cost and value.",
    input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "party_balances", description: "Outstanding balances: customers who owe us (kind=customer) or suppliers we owe (kind=supplier).",
    input_schema: { type: "object", properties: { kind: { type: "string", enum: ["customer", "supplier"] } }, required: ["kind"], additionalProperties: false } },
  { name: "expenses_by_category", description: "Expense totals per category for a date range.",
    input_schema: { type: "object", properties: { ...range }, required: ["from", "to"], additionalProperties: false } },
  { name: "top_products", description: "Best products in a date range ranked by profit, revenue or quantity sold.",
    input_schema: { type: "object", properties: { ...range, by: { type: "string", enum: ["profit", "revenue", "qty"] }, limit: { type: "integer" } }, required: ["from", "to", "by"], additionalProperties: false } },
  { name: "trend", description: "Daily or monthly series of sales, purchases, expenses and profit.",
    input_schema: { type: "object", properties: { ...range, granularity: { type: "string", enum: ["day", "month"] } }, required: ["from", "to", "granularity"], additionalProperties: false } },
  { name: "list_transactions", description: "List individual transactions with filters. type: purchase, sale, expense, receipt, payment, sale_return, purchase_return, stock_adjustment.",
    input_schema: { type: "object", properties: { ...range, type: { type: ["string", "null"] }, search: { type: ["string", "null"] }, limit: { type: "integer" } }, required: ["from", "to"], additionalProperties: false } },
  { name: "vat_summary", description: "VAT on sales and purchases for a period, for preparing a VAT return (working figures, not an official FTA filing).",
    input_schema: { type: "object", properties: { ...range }, required: ["from", "to"], additionalProperties: false } },
  { name: "download_link", description: "Make a download link for a report file the owner can open in Excel or print.",
    input_schema: { type: "object", properties: {
      report: { type: "string", enum: ["transactions", "sales", "purchases", "expenses", "stock", "pnl", "summary", "receivables", "payables", "vat"] },
      ...range, format: { type: "string", enum: ["xlsx", "csv", "pdf"] } }, required: ["report", "from", "to", "format"], additionalProperties: false } },
];

function dates(i: Record<string, unknown>) {
  const t = todayISO();
  const from = isISODate(i.from) ? i.from : t;
  const to = isISODate(i.to) ? i.to : t;
  return { from, to };
}

async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const { from, to } = dates(input);
  switch (name) {
    case "period_summary": return R.periodSummary(from, to);
    case "balances": return R.balances(isISODate(input.as_of) ? input.as_of : todayISO());
    case "product_lookup": {
      const ps = await R.findProducts(String(input.query ?? ""), 5);
      const stats = await R.productStats(ps.map((p) => p.id), from, to);
      return ps.map((p) => {
        const s = stats.find((x) => x.product_id === p.id);
        return {
          name: p.name, unit: p.unit, category: p.category, is_service: p.is_service,
          stock: num(p.qty_on_hand), selling_price: num(p.selling_price), last_purchase_price: num(s?.last_purchase_price ?? p.purchase_price),
          last_purchase_date: s?.last_purchase_date ?? null, average_cost: num(p.avg_cost),
          period: { from, to, qty_sold: num(s?.qty_sold), qty_returned: num(s?.qty_returned), sales_net: num(s?.sales_net),
            cogs: num(s?.cogs), profit: Math.round((num(s?.sales_net) - num(s?.cogs)) * 100) / 100,
            qty_purchased: num(s?.qty_purchased), purchase_net: num(s?.purchase_net) },
        };
      });
    }
    case "low_stock": return (await R.lowStock()).map((p) => ({ name: p.name, unit: p.unit, stock: num(p.qty_on_hand), reorder_level: num(p.reorder_level) }));
    case "stock_list": return (await R.stockValuation()).map((p) => ({ name: p.name, category: p.category, unit: p.unit, stock: num(p.qty_on_hand), avg_cost: num(p.avg_cost), value: num(p.value) }));
    case "party_balances": {
      const kind = input.kind === "supplier" ? "supplier" : "customer";
      const rows = (await R.partyBalances(kind, todayISO())).filter((r) => r.balance !== 0);
      return { kind, total: Math.round(rows.reduce((s, r) => s + r.balance, 0) * 100) / 100, parties: rows.map((r) => ({ name: r.name, balance: r.balance, phone: r.phone, last_transaction: r.last_date })) };
    }
    case "expenses_by_category": return R.expensesByCategory(from, to);
    case "top_products": return R.topProducts(from, to, (input.by as "profit") ?? "profit", Math.min(Number(input.limit ?? 10), 50));
    case "trend": return input.granularity === "month" ? R.monthlySeries(from, to) : R.dailySeries(from, to);
    case "list_transactions": {
      const rows = await R.listTransactions({ from, to, type: (input.type as string) ?? null, q: (input.search as string) ?? null, limit: Math.min(Number(input.limit ?? 30), 100) });
      return rows.map((r) => ({ ref: r.ref_no, date: r.txn_date, type: r.type, party: r.party, items: r.items, total: num(r.total), payment: r.payment_method, by: r.created_by }));
    }
    case "vat_summary": return R.vatReport(from, to);
    case "download_link": {
      const u = new URLSearchParams({ report: String(input.report), from, to, format: String(input.format) });
      return { url: `/api/export?${u.toString()}` };
    }
  }
  throw new Error(`Unknown tool ${name}`);
}

const SYSTEM = `You are the accounting assistant of a retail shop in the UAE (currency AED). You answer the owner's questions
about the shop's sales, purchases, stock, expenses, profit, money owed and VAT.

Hard rules:
- Every number you state must come from a tool result in this conversation. Never estimate, guess or invent figures.
  If the tools return nothing, say there is no data recorded for that.
- Call tools to get the figures; call several at once when the question needs them. Work out dates yourself from today's date.
- "Profit" means net profit after cost of goods sold and expenses (from period_summary), not sales revenue.
  Say "gross profit" when you mean sales minus cost of goods sold.
- Reply in the language the owner used (Malayalam script, Manglish, English or Arabic). Keep it short and clear:
  the answer first, then a small table if it helps. Format money as AED 1,234.50.
- For VAT, say the figures are for preparing the return and must be checked before filing with the FTA.
- When the owner asks for a report file / Excel / PDF / download, call download_link and give the link as a Markdown link.
- If a product name matches several products, show them and ask which one.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export async function chat(history: ChatTurn[], userId: string) {
  if (!history.length || history[history.length - 1].role !== "user") throw new HttpError(400, "Ask a question");
  await assertBudget();
  const today = todayISO();
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-12).map((h) => ({ role: h.role, content: h.content.slice(0, 4000) }));
  // the date goes in a final system message so the cached system prompt stays identical across days
  messages.push({ role: "system", content: `Today is ${today} (yesterday ${addDays(today, -1)}), time zone Asia/Dubai.` } as unknown as Anthropic.Beta.BetaMessageParam);
  const model = MODELS.chat;
  let cost = 0;
  const used: string[] = [];

  for (let step = 0; step < 8; step++) {
    const res = await claude().beta.messages.create({
      model,
      max_tokens: 16000,
      ...FALLBACK,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      output_config: { effort: "medium" },
      messages,
    });
    cost += await logUsage("chat", res.model ?? model, res.usage, userId);
    if (res.stop_reason === "refusal") return { reply: "Sorry, I can't answer that one.", cost_usd: cost, tools: used };
    messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || calls.length === 0) {
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { reply: text || "I could not find an answer.", cost_usd: cost, tools: used };
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(calls.map(async (c) => {
      used.push(c.name);
      try {
        const out = await runTool(c.name, (c.input ?? {}) as Record<string, unknown>);
        return { type: "tool_result" as const, tool_use_id: c.id, content: JSON.stringify(out) };
      } catch (e) {
        return { type: "tool_result" as const, tool_use_id: c.id, content: `Error: ${e instanceof Error ? e.message : e}`, is_error: true };
      }
    }));
    messages.push({ role: "user", content: results });
  }
  return { reply: "That question needed too many steps. Please ask in a simpler way.", cost_usd: cost, tools: used };
}
