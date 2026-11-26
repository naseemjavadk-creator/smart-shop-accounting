import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { claude, FALLBACK, logUsage, assertBudget, refusalText } from "./claude";
import { provider, CLAUDE_MODELS, GEMINI_MODELS } from "./provider";
import { generateJSON } from "./gemini";
import { fileToContent, toClaude, toGemini, type DocPart } from "./ocr";
import { q, num } from "../db";
import { addDays, todayISO } from "../dates";
import { r2, r4 } from "../money";
import { findProducts } from "../reports";
import { HttpError } from "../auth";

const ItemSchema = z.object({
  spoken_name: z.string().describe("The item exactly as the speaker named it"),
  product_id: z.string().nullable().describe("id from the product list when it is clearly the same product, else null"),
  new_product_name: z.string().nullable().describe("Clean English product name to create when no product matches, else null"),
  qty: z.number().describe("Quantity. Use 1 for services or when not said"),
  unit: z.string().nullable().describe("kg, gram, box, piece, packet, litre, dozen, page, ..."),
  unit_price: z.number().nullable().describe("Price for ONE unit, only if the speaker said a per-unit price"),
  line_total: z.number().nullable().describe("Total for this item, only if the speaker said a total"),
  is_service: z.boolean().describe("true for printing, photocopy, typing, digital services, recharge etc."),
});

const DraftSchema = z.object({
  understood_text: z.string().describe("Short English restatement of what was said"),
  transactions: z.array(z.object({
    type: z.enum(["purchase", "sale", "expense", "receipt", "payment", "sale_return", "purchase_return"]),
    date: z.string().nullable().describe("YYYY-MM-DD"),
    party_name: z.string().nullable().describe("Supplier or customer name if said"),
    payment_method: z.enum(["cash", "bank", "card", "credit"]),
    items: z.array(ItemSchema),
    expense_account_id: z.number().nullable().describe("For expenses: id from the expense category list"),
    description: z.string().nullable(),
    amount: z.number().nullable().describe("For expense / receipt / payment: the amount said"),
    prices_include_vat: z.boolean().nullable().describe("true if the speaker said the price includes VAT, false if plus VAT, else null"),
    confidence: z.enum(["high", "medium", "low"]),
    questions: z.array(z.string()).describe("Anything unclear the employee must check, in simple English"),
  })),
});
export type Draft = z.infer<typeof DraftSchema>;

const SYSTEM = `You turn what a shop employee said or typed into accounting entries for a retail shop in the UAE
(stationery, books, printing/photocopy, digital services, vegetables, groceries, mobile accessories).
The speaker may use English, Malayalam (മലയാളം script), Manglish (Malayalam in English letters), Arabic, or a mix.
Currency is AED (dirham, dirhams, dhs, ദിർഹം, درهم). Speech-to-text may have mistakes: use common sense.

Rules:
- Decide the type: purchase (bought / vangichu / വാങ്ങി / اشتريت), sale (sold / vittu / വിറ്റു / بعت), expense
  (paid for rent, electricity, salary, transport... / koduthu / അടച്ചു), receipt (a customer paid money they owed),
  payment (we paid a supplier money we owed), sale_return, purchase_return.
- Dates: "today / innu / ഇന്ന്" = today, "yesterday / innale / ഇന്നലെ" = yesterday. If no date, use today.
- Amount meaning: "20 box pen 100 dirhams" means 100 is the TOTAL for all 20 boxes (line_total 100).
  Only treat a price as per-unit when the speaker says each / per / oronninum / ഓരോന്നിനും / one for / "at 5 each".
  "10 notebooks at 5 AED each" → unit_price 5. Never invent a price that was not said: leave it null.
- Match items to the product list by meaning, including Malayalam/Arabic names and spelling mistakes
  ("pena" = pen, "thakkali / തക്കാളി" = tomato, "nottu book" = notebook). Use the product's id only if you are confident.
  Otherwise set product_id null and give a clean English new_product_name.
- Units: kilo/kg/കിലോ → kg; box/petti → box; packet/paketh → packet; piece/ennam/എണ്ണം → piece; litre → litre.
- Payment: default cash. "credit / kadam / കടം / later / not paid" → credit. "card" → card. "bank / transfer" → bank.
- One message can contain several transactions or several items: return each.
- For expenses pick expense_account_id from the expense categories list; use "Other expenses" when unsure.
- If something important is unclear (amount, quantity, which product), set confidence low and add a short question.
  Never guess numbers.`;

type Catalog = { products: { id: string; name: string; unit: string; selling_price: string; purchase_price: string; aliases: string[] }[];
  expenseAccounts: { id: number; name: string }[]; suppliers: string[]; customers: string[] };

async function catalog(): Promise<Catalog> {
  const [products, expenseAccounts, parties] = await Promise.all([
    q<Catalog["products"][number]>(
      `select p.id, p.name, p.unit, p.selling_price, p.purchase_price, p.aliases from products p
        where p.active order by (select max(t.created_at) from transaction_lines tl join transactions t on t.id = tl.txn_id
                                  where tl.product_id = p.id) desc nulls last, p.name limit 400`),
    q<{ id: number; name: string }>(`select id, name from accounts where is_expense_category and active order by code`),
    q<{ kind: string; name: string }>(`select kind, name from parties where active order by created_at desc limit 200`),
  ]);
  return {
    products, expenseAccounts,
    suppliers: parties.filter((p) => p.kind === "supplier").map((p) => p.name),
    customers: parties.filter((p) => p.kind === "customer").map((p) => p.name),
  };
}

export type ParsedLine = {
  spoken_name: string; product_id: string | null; product_name: string | null; new_product_name: string | null;
  qty: number; unit: string | null; unit_price: number; line_total: number; is_service: boolean;
  price_source: "said" | "computed" | "catalog" | "missing";
  candidates: { id: string; name: string; unit: string; selling_price: number; purchase_price: number }[];
};
export type ParsedTxn = Omit<Draft["transactions"][number], "items"> & { items: ParsedLine[]; total: number };

export type TypeHint = Draft["transactions"][number]["type"] | null;

const HINT_LABEL: Record<string, string> = {
  sale: "Sale", purchase: "Purchase", expense: "Expense", receipt: "Payment received from a customer",
  payment: "Payment to a supplier", sale_return: "Sales return", purchase_return: "Purchase return",
};
const hintText = (h: TypeHint | undefined) =>
  h ? `The employee is on the "${HINT_LABEL[h]}" screen, so the entries are most likely of type "${h}" unless the words or document clearly say otherwise.` : "";

type Parsed = { understood_text: string; transactions: ParsedTxn[]; cost_usd: number };

export async function parseTransactionText(text: string, userId: string, hint?: TypeHint): Promise<Parsed> {
  const clean = text.trim();
  if (!clean) throw new HttpError(400, "Nothing to understand");
  if (clean.length > 3000) throw new HttpError(400, "Too long. Please say one or a few transactions at a time.");
  return parseInput({ said: `The employee said:\n"""${clean}"""`, userId, hint, feature: "parse" });
}

/**
 * Read a photo / PDF / Excel / Word file (bill, receipt, handwritten note, sales report) into draft entries
 * of any type. The employee confirms each entry before it is saved.
 */
export async function parseFile(data: Buffer, mime: string, filename: string, userId: string, hint?: TypeHint): Promise<Parsed> {
  const parts = await fileToContent(data, mime, filename);
  if (provider() === "gemini" && data.length > 18 * 1024 * 1024) throw new HttpError(413, "File is too large for the AI. Take a smaller photo or split the file.");
  return parseInput({
    said: "The employee uploaded the document above (a bill, receipt, handwritten note, or sales/expense list). Make the entries it shows. Copy numbers exactly as written; if a number cannot be read, leave it null and add a question.",
    parts, userId, hint, feature: "ocr",
  });
}

async function parseInput({ said, parts = [], userId, hint, feature }: { said: string; parts?: DocPart[]; userId: string; hint?: TypeHint; feature: string }): Promise<Parsed> {
  await assertBudget();
  const cat = await catalog();
  const today = todayISO();

  const context = [
    `Today is ${today}. Yesterday was ${addDays(today, -1)}.`,
    `Products (id | name | unit | selling price | last purchase price | other names):`,
    ...cat.products.map((p) => `${p.id} | ${p.name} | ${p.unit} | ${num(p.selling_price)} | ${num(p.purchase_price)} | ${p.aliases.join(", ")}`),
    `Expense categories (id | name):`,
    ...cat.expenseAccounts.map((a) => `${a.id} | ${a.name}`),
    `Known suppliers: ${cat.suppliers.join(", ") || "none"}`,
    `Known customers: ${cat.customers.join(", ") || "none"}`,
  ].join("\n");

  const hinted = [hintText(hint), said].filter(Boolean).join("\n");
  let draft: Draft, cost: number;
  if (provider() === "gemini") {
    const r = await generateJSON({ feature, model: parts.length ? GEMINI_MODELS.ocr : GEMINI_MODELS.parse, userId, system: SYSTEM,
      parts: [{ text: context }, ...toGemini(parts), { text: hinted }], schema: DraftSchema });
    draft = r.data; cost = r.cost;
  } else {
    const model = parts.length ? CLAUDE_MODELS.ocr : CLAUDE_MODELS.parse;
    const msg = await claude().beta.messages.parse({
      model,
      max_tokens: 16000,
      ...FALLBACK,
      system: SYSTEM,
      output_config: { effort: "low", format: betaZodOutputFormat(DraftSchema) },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: context, cache_control: { type: "ephemeral" } },
          ...toClaude(parts),
          { type: "text", text: hinted },
        ],
      }],
    });
    cost = await logUsage(feature, msg.model ?? model, msg.usage, userId);
    const refused = refusalText(msg);
    if (refused) throw new HttpError(422, refused);
    if (!msg.parsed_output) throw new HttpError(422, "Could not understand. Please try again or type it.");
    draft = msg.parsed_output;
  }

  const byId = new Map(cat.products.map((p) => [p.id, p]));
  const validExpense = new Set(cat.expenseAccounts.map((a) => a.id));
  const out: ParsedTxn[] = [];
  for (const t of draft.transactions) {
    const items: ParsedLine[] = [];
    for (const it of t.items) {
      const known = it.product_id && byId.has(it.product_id) ? byId.get(it.product_id)! : null;
      const qty = it.qty > 0 ? it.qty : 1;
      let unitPrice: number, total: number, src: ParsedLine["price_source"];
      if (it.unit_price != null && it.unit_price >= 0) {
        unitPrice = it.unit_price; total = r2(qty * unitPrice); src = "said";
      } else if (it.line_total != null && it.line_total >= 0) {
        total = r2(it.line_total); unitPrice = r4(total / qty); src = "computed";
      } else if (known) {
        unitPrice = num(t.type === "sale" || t.type === "sale_return" ? known.selling_price : known.purchase_price);
        total = r2(qty * unitPrice); src = unitPrice > 0 ? "catalog" : "missing";
      } else {
        unitPrice = 0; total = 0; src = "missing";
      }
      const cands = (await findProducts(it.new_product_name || it.spoken_name, 4)).map((p) => ({
        id: p.id, name: p.name, unit: p.unit, selling_price: num(p.selling_price), purchase_price: num(p.purchase_price),
      }));
      items.push({
        spoken_name: it.spoken_name, product_id: known?.id ?? null, product_name: known?.name ?? null,
        new_product_name: known ? null : it.new_product_name || it.spoken_name,
        qty, unit: it.unit ?? known?.unit ?? null, unit_price: unitPrice, line_total: total,
        is_service: it.is_service, price_source: src, candidates: cands,
      });
      if (src === "missing") t.questions.push(`Price for "${it.spoken_name}" was not said. Please enter it.`);
    }
    const total = r2(items.reduce((s, i) => s + i.line_total, 0)) || r2(t.amount ?? 0);
    out.push({
      ...t,
      date: t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : today,
      expense_account_id: t.expense_account_id && validExpense.has(t.expense_account_id) ? t.expense_account_id : null,
      items,
      total,
    });
  }
  return { understood_text: draft.understood_text, transactions: out, cost_usd: cost };
}
