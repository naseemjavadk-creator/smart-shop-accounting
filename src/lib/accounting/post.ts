import "server-only";
import type { PoolClient } from "pg";
import { tx, q, q1, num } from "../db";
import { r2, r4 } from "../money";
import { getSetting } from "../settings";
import { audit } from "../audit";
import { HttpError, can, type SessionUser } from "../auth";
import { TxnSchema, type TxnInput, type TxnType, type LineInput } from "./schema";
import { enqueueTxnSync } from "../sheets/queue";

type Acc = Record<string, number>;
type JLine = { account_id: number; party_id?: string | null; debit?: number; credit?: number };

type Product = {
  id: string; name: string; unit: string; is_service: boolean; avg_cost: string;
  qty_on_hand: string; vat_category: string; selling_price: string;
};

type ComputedLine = {
  line_no: number;
  product: Product | null;
  description: string;
  qty: number;
  unit: string | null;
  unit_price: number;
  discount: number;
  vat_rate: number;
  vat_category: string;
  net: number;
  vat: number;
  total: number;
  unit_cost: number | null;
  cogs: number;
  sale_line_id: number | null;
};

export type PostResult = { id: string; ref_no: string; duplicate: boolean; total: number; warnings: string[] };

const PERM: Record<TxnType, "purchases" | "sales" | "expenses" | "admin"> = {
  purchase: "purchases",
  purchase_return: "purchases",
  payment: "purchases",
  sale: "sales",
  sale_return: "sales",
  receipt: "sales",
  expense: "expenses",
  stock_adjustment: "purchases",
  transfer: "admin",
  journal: "admin",
};

const PARTY_KIND: Partial<Record<TxnType, "supplier" | "customer">> = {
  purchase: "supplier", purchase_return: "supplier", payment: "supplier", expense: "supplier",
  sale: "customer", sale_return: "customer", receipt: "customer",
};

async function accounts(c: PoolClient): Promise<Acc> {
  const rows = await q<{ id: number; system_key: string }>(
    `select id, system_key from accounts where system_key is not null`, [], c);
  return Object.fromEntries(rows.map((r) => [r.system_key, r.id]));
}

function payAccount(acc: Acc, method: string): number {
  return method === "cash" ? acc.cash : acc.bank; // card settlements land in the bank
}

async function resolveParty(c: PoolClient, input: TxnInput, userId: string): Promise<string | null> {
  const kind = PARTY_KIND[input.type];
  if (input.party_id) return input.party_id;
  const name = input.party_name?.trim();
  if (!name || !kind) return null;
  const found = await q1<{ id: string }>(
    `select id from parties where kind = $1 and lower(name) = lower($2)`, [kind, name], c);
  if (found) return found.id;
  const created = await q1<{ id: string }>(
    `insert into parties (kind, name) values ($1, $2) returning id`, [kind, name], c);
  await audit(userId, "create", "party", created!.id, { kind, name, auto: true }, c);
  return created!.id;
}

async function resolveProduct(c: PoolClient, l: LineInput, input: TxnInput, userId: string): Promise<Product | null> {
  if (l.product_id) {
    const p = await q1<Product>(`select * from products where id = $1 for update`, [l.product_id], c);
    if (!p) throw new HttpError(400, `Product not found for line "${l.description}"`);
    return p;
  }
  if (!l.new_product) return null;
  const np = l.new_product;
  const existing = await q1<Product>(
    `select * from products where lower(name) = lower($1) and active for update`, [np.name], c);
  if (existing) return existing;
  const isSale = input.type === "sale";
  const p = await q1<Product>(
    `insert into products (name, unit, is_service, category_id, selling_price, purchase_price, vat_category)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [np.name, np.unit, np.is_service, np.category_id ?? null,
     np.selling_price ?? (isSale ? l.unit_price : 0), isSale ? 0 : l.unit_price, np.vat_category],
    c,
  );
  await audit(userId, "create", "product", p!.id, { name: np.name, auto: true }, c);
  return p;
}

function computeLine(
  i: number, l: LineInput, p: Product | null, includeVat: boolean, vatRegistered: boolean, stdRate: number,
): ComputedLine {
  const qty = num(l.qty);
  const unitPrice = num(l.unit_price);
  const discount = num(l.discount);
  const cat = l.vat_category ?? p?.vat_category ?? "standard";
  const rate = vatRegistered && cat === "standard" ? stdRate : 0;
  const gross = r2(Math.abs(qty) * unitPrice - discount);
  let net: number, vat: number;
  if (includeVat) {
    net = r2(gross / (1 + rate / 100));
    vat = r2(gross - net);
  } else {
    net = gross;
    vat = r2((net * rate) / 100);
  }
  return {
    line_no: i + 1,
    product: p,
    description: l.description || p?.name || "Item",
    qty,
    unit: l.unit ?? p?.unit ?? null,
    unit_price: unitPrice,
    discount,
    vat_rate: rate,
    vat_category: cat,
    net,
    vat,
    total: r2(net + vat),
    unit_cost: null,
    cogs: 0,
    sale_line_id: l.sale_line_id ?? null,
  };
}

/** Adjust stock and (for incoming stock with a cost) the weighted-average cost. */
async function moveStock(
  c: PoolClient, p: Product, txnId: string, qtyChange: number, unitCost: number, reason: string,
  opts: { updateAvg: boolean; setPurchasePrice?: number },
) {
  const onHand = num(p.qty_on_hand);
  let avg = num(p.avg_cost);
  if (opts.updateAvg && qtyChange > 0) {
    const base = Math.max(onHand, 0);
    avg = base + qtyChange > 0 ? r4((base * avg + qtyChange * unitCost) / (base + qtyChange)) : unitCost;
  }
  await q(
    `insert into stock_movements (product_id, txn_id, qty_change, unit_cost, reason) values ($1,$2,$3,$4,$5)`,
    [p.id, txnId, qtyChange, unitCost, reason], c);
  await q(
    `update products set qty_on_hand = qty_on_hand + $2, avg_cost = $3,
            purchase_price = coalesce($4, purchase_price), updated_at = now() where id = $1`,
    [p.id, qtyChange, avg, opts.setPurchasePrice ?? null], c);
  p.qty_on_hand = String(onHand + qtyChange);
  p.avg_cost = String(avg);
}

async function writeJournal(c: PoolClient, txnId: string, date: string, memo: string, lines: JLine[], reversal = false) {
  const clean = lines
    .map((l) => ({ ...l, debit: r2(l.debit ?? 0), credit: r2(l.credit ?? 0) }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);
  // fold any 1-fils rounding difference into the largest line so the entry always balances
  const d = r2(clean.reduce((s, l) => s + l.debit, 0));
  const cr = r2(clean.reduce((s, l) => s + l.credit, 0));
  const diff = r2(d - cr);
  if (Math.abs(diff) > 0.05) throw new Error(`Posting rule produced an unbalanced entry (${d} vs ${cr})`);
  if (diff !== 0) {
    const target = clean.filter((l) => l.credit > 0).sort((a, b) => b.credit - a.credit)[0];
    target.credit = r2(target.credit + diff);
  }
  if (clean.length === 0) return;
  const e = await q1<{ id: string }>(
    `insert into journal_entries (txn_id, entry_date, memo, is_reversal) values ($1,$2,$3,$4) returning id`,
    [txnId, date, memo, reversal], c);
  for (const l of clean) {
    await q(
      `insert into journal_lines (entry_id, account_id, party_id, debit, credit) values ($1,$2,$3,$4,$5)`,
      [e!.id, l.account_id, l.party_id ?? null, l.debit, l.credit], c);
  }
}

/**
 * Validate, compute and post one business transaction atomically:
 * the document, its lines, stock movements, double-entry journal, audit log and Sheets queue.
 * Safe to retry: the device-generated idempotency_key makes a repeated call return the first result.
 */
export async function postTransaction(raw: unknown, user: SessionUser): Promise<PostResult> {
  const input = TxnSchema.parse(raw);
  if (!can(user, PERM[input.type])) throw new HttpError(403, "You do not have permission to record this");

  const prior = await q1<{ id: string; ref_no: string; total: string }>(
    `select id, ref_no, total from transactions where idempotency_key = $1`, [input.idempotency_key]);
  if (prior) return { id: prior.id, ref_no: prior.ref_no, duplicate: true, total: num(prior.total), warnings: [] };

  const vatS = await getSetting("vat");
  const warnings: string[] = [];

  try {
    const result = await tx(async (c) => {
      const acc = await accounts(c);
      const partyId = await resolveParty(c, input, user.id);
      const t = input.type;
      const includeVat =
        input.prices_include_vat ??
        (t === "sale" || t === "sale_return" ? vatS.sales_prices_include_vat : vatS.purchase_prices_include_vat);
      const vatRecoverable = vatS.registered;

      // ---- lines ----
      const needsLines = ["purchase", "sale", "expense", "sale_return", "purchase_return", "stock_adjustment"].includes(t);
      let lines: ComputedLine[] = [];
      if (needsLines) {
        if (input.lines.length === 0 && t === "expense" && input.amount) {
          input.lines = [{ description: input.notes || "Expense", qty: 1, unit_price: input.amount, discount: 0 }];
        }
        if (input.lines.length === 0) throw new HttpError(400, "Add at least one item");
        for (const [i, l] of input.lines.entries()) {
          const p = t === "expense" ? null : await resolveProduct(c, l, input, user.id);
          if (t === "stock_adjustment") {
            if (!p) throw new HttpError(400, "Stock adjustments need a product");
            const cost = input.adjustment_reason === "opening" ? num(l.unit_price) : num(p.avg_cost);
            lines.push({
              line_no: i + 1, product: p, description: l.description || p.name, qty: num(l.qty),
              unit: l.unit ?? p.unit, unit_price: cost, discount: 0, vat_rate: 0, vat_category: p.vat_category,
              net: r2(Math.abs(num(l.qty)) * cost), vat: 0, total: r2(Math.abs(num(l.qty)) * cost),
              unit_cost: cost, cogs: 0, sale_line_id: null,
            });
          } else {
            if (num(l.qty) <= 0) throw new HttpError(400, `Quantity must be more than 0 for "${l.description || p?.name}"`);
            lines.push(computeLine(i, l, p, includeVat, vatS.registered, vatS.standard_rate));
          }
        }
        // a supplier bill's printed VAT wins over our calculation (spread onto the largest line)
        if ((t === "purchase" || t === "expense") && input.vat_override != null) {
          const calc = r2(lines.reduce((s, l) => s + l.vat, 0));
          const diff = r2(input.vat_override - calc);
          if (diff !== 0) {
            const big = [...lines].sort((a, b) => b.net - a.net)[0];
            if (includeVat) big.net = r2(big.net - diff);
            big.vat = r2(big.vat + diff);
            big.total = r2(big.net + big.vat);
          }
        }
      }

      const subtotal = r2(lines.reduce((s, l) => s + l.net, 0));
      const vatAmt = r2(lines.reduce((s, l) => s + l.vat, 0));
      const discount = r2(lines.reduce((s, l) => s + l.discount, 0));
      let total = r2(subtotal + vatAmt);
      if (["receipt", "payment", "transfer"].includes(t)) {
        if (!input.amount || input.amount <= 0) throw new HttpError(400, "Enter the amount");
        total = r2(input.amount);
      }
      if (t === "journal") {
        const d = r2(input.journal_lines.reduce((s, l) => s + l.debit, 0));
        const cr = r2(input.journal_lines.reduce((s, l) => s + l.credit, 0));
        if (d !== cr || d === 0) throw new HttpError(400, "Debits and credits must be equal");
        total = d;
      }

      let paid = input.payment_method === "credit" ? 0 : r2(input.amount_paid ?? total);
      if (t === "stock_adjustment" || t === "journal") paid = 0;
      if (paid > total) throw new HttpError(400, "Amount paid is more than the total");
      const balance = r2(total - paid);
      if (balance > 0 && !partyId && ["purchase", "sale", "expense", "sale_return", "purchase_return"].includes(t)) {
        throw new HttpError(400, t === "sale" || t === "sale_return"
          ? "Customer name is needed for a credit sale"
          : "Supplier name is needed for a credit purchase");
      }
      if ((t === "receipt" || t === "payment") && !partyId)
        throw new HttpError(400, t === "receipt" ? "Choose the customer" : "Choose the supplier");
      if ((t === "receipt" || t === "payment" || t === "transfer") && input.payment_method === "credit")
        throw new HttpError(400, "Choose cash or bank");
      if (t === "expense" && !input.expense_account_id) {
        input.expense_account_id = acc.other_expense;
      }

      const notes = t === "transfer"
        ? `${input.payment_method === "cash" ? "Cash" : "Bank"} → ${input.transfer_to === "cash" ? "Cash" : "Bank"}${input.notes ? " · " + input.notes : ""}`
        : input.notes ?? null;

      const row = await q1<{ id: string; ref_no: string }>(
        `insert into transactions (type, txn_date, party_id, payment_method, prices_include_vat, subtotal, discount,
            vat_amount, total, amount_paid, expense_account_id, invoice_no, notes, source, raw_input, idempotency_key,
            device_id, file_id, related_txn_id, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         returning id, ref_no`,
        [t, input.txn_date, partyId, input.payment_method, includeVat, subtotal, discount, vatAmt, total, paid,
         t === "expense" ? input.expense_account_id : null, input.invoice_no || null, notes, input.source,
         input.raw_input ?? null, input.idempotency_key, input.device_id ?? null, input.file_id ?? null,
         input.related_txn_id ?? null, user.id],
        c,
      );
      const txnId = row!.id;
      const J: JLine[] = [];
      const payAcc = payAccount(acc, input.payment_method);

      // ---- posting rules ----
      switch (t) {
        case "purchase": {
          for (const l of lines) {
            const costNet = vatRecoverable ? l.net : l.total; // unregistered: VAT becomes part of cost
            if (l.product && !l.product.is_service) {
              const unitCost = l.qty > 0 ? r4(costNet / l.qty) : 0;
              await moveStock(c, l.product, txnId, l.qty, unitCost, "purchase", { updateAvg: true, setPurchasePrice: unitCost });
              l.unit_cost = unitCost;
              J.push({ account_id: acc.inventory, debit: costNet });
            } else {
              J.push({ account_id: acc.nonstock_purchases, debit: costNet });
            }
          }
          if (vatRecoverable) J.push({ account_id: acc.vat_input, debit: vatAmt });
          J.push({ account_id: payAcc, credit: paid });
          J.push({ account_id: acc.ap, party_id: partyId, credit: balance });
          break;
        }
        case "sale": {
          for (const l of lines) {
            const svc = !l.product || l.product.is_service;
            J.push({ account_id: svc ? acc.sales_services : acc.sales_goods, credit: l.net });
            if (l.product && !l.product.is_service) {
              const unitCost = num(l.product.avg_cost);
              if (num(l.product.qty_on_hand) < l.qty)
                warnings.push(`Stock of ${l.product.name} goes below zero (had ${num(l.product.qty_on_hand)}).`);
              if (unitCost === 0) warnings.push(`${l.product.name} has no purchase cost yet, so profit shows as full price.`);
              l.unit_cost = unitCost;
              l.cogs = r2(unitCost * l.qty);
              await moveStock(c, l.product, txnId, -l.qty, unitCost, "sale", { updateAvg: false });
              J.push({ account_id: acc.cogs, debit: l.cogs });
              J.push({ account_id: acc.inventory, credit: l.cogs });
            }
          }
          J.push({ account_id: acc.vat_output, credit: vatAmt });
          J.push({ account_id: payAcc, debit: paid });
          J.push({ account_id: acc.ar, party_id: partyId, debit: balance });
          break;
        }
        case "expense": {
          const net = vatRecoverable ? subtotal : total;
          J.push({ account_id: input.expense_account_id!, debit: net });
          if (vatRecoverable) J.push({ account_id: acc.vat_input, debit: vatAmt });
          J.push({ account_id: payAcc, credit: paid });
          J.push({ account_id: acc.ap, party_id: partyId, credit: balance });
          break;
        }
        case "sale_return": {
          for (const l of lines) {
            J.push({ account_id: acc.sales_returns, debit: l.net });
            if (l.product && !l.product.is_service) {
              let unitCost = num(l.product.avg_cost);
              if (l.sale_line_id) {
                const orig = await q1<{ unit_cost: string | null }>(
                  `select unit_cost from transaction_lines where id = $1`, [l.sale_line_id], c);
                if (orig?.unit_cost != null) unitCost = num(orig.unit_cost);
              }
              l.unit_cost = unitCost;
              l.cogs = r2(unitCost * l.qty);
              await moveStock(c, l.product, txnId, l.qty, unitCost, "sale_return", { updateAvg: true });
              J.push({ account_id: acc.inventory, debit: l.cogs });
              J.push({ account_id: acc.cogs, credit: l.cogs });
            }
          }
          J.push({ account_id: acc.vat_output, debit: vatAmt });
          J.push({ account_id: payAcc, credit: paid });
          J.push({ account_id: acc.ar, party_id: partyId, credit: balance });
          break;
        }
        case "purchase_return": {
          for (const l of lines) {
            const costNet = vatRecoverable ? l.net : l.total;
            if (l.product && !l.product.is_service) {
              const unitCost = l.qty > 0 ? r4(costNet / l.qty) : 0;
              await moveStock(c, l.product, txnId, -l.qty, unitCost, "purchase_return", { updateAvg: false });
              J.push({ account_id: acc.inventory, credit: costNet });
            } else {
              J.push({ account_id: acc.nonstock_purchases, credit: costNet });
            }
          }
          if (vatRecoverable) J.push({ account_id: acc.vat_input, credit: vatAmt });
          J.push({ account_id: payAcc, debit: paid });
          J.push({ account_id: acc.ap, party_id: partyId, debit: balance });
          break;
        }
        case "receipt":
          J.push({ account_id: payAcc, debit: total });
          J.push({ account_id: acc.ar, party_id: partyId, credit: total });
          break;
        case "payment":
          J.push({ account_id: acc.ap, party_id: partyId, debit: total });
          J.push({ account_id: payAcc, credit: total });
          break;
        case "transfer": {
          const to = input.transfer_to === "cash" ? acc.cash : acc.bank;
          if (to === payAcc) throw new HttpError(400, "Choose different accounts to transfer between");
          J.push({ account_id: to, debit: total });
          J.push({ account_id: payAcc, credit: total });
          break;
        }
        case "stock_adjustment": {
          const reason = input.adjustment_reason ?? "count";
          for (const l of lines) {
            const value = l.net;
            await moveStock(c, l.product!, txnId, l.qty, l.unit_cost ?? 0, reason, { updateAvg: reason === "opening" });
            const offset = reason === "opening" ? acc.opening_equity : acc.stock_adjustment;
            if (l.qty > 0) {
              J.push({ account_id: acc.inventory, debit: value });
              J.push({ account_id: offset, credit: value });
            } else {
              J.push({ account_id: offset, debit: value });
              J.push({ account_id: acc.inventory, credit: value });
            }
          }
          break;
        }
        case "journal":
          for (const l of input.journal_lines) J.push({ account_id: l.account_id, party_id: l.party_id, debit: l.debit, credit: l.credit });
          break;
      }

      for (const l of lines) {
        await q(
          `insert into transaction_lines (txn_id, line_no, product_id, description, qty, unit, unit_price, discount,
              vat_rate, vat_category, net_amount, vat_amount, line_total, unit_cost, cogs_amount)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [txnId, l.line_no, l.product?.id ?? null, l.description, l.qty, l.unit, l.unit_price, l.discount,
           l.vat_rate, l.vat_category, l.net, l.vat, l.total, l.unit_cost, l.cogs],
          c,
        );
      }
      await writeJournal(c, txnId, input.txn_date, `${t} ${row!.ref_no}`, J);
      if (input.ocr_job_id) {
        await q(`update ocr_jobs set status = 'saved', txn_id = $2, updated_at = now() where id = $1`, [input.ocr_job_id, txnId], c);
      }
      await audit(user.id, "create", "transaction", txnId, { type: t, ref_no: row!.ref_no, total, source: input.source }, c);
      await enqueueTxnSync(c, txnId, t, lines.map((l) => l.product?.id).filter(Boolean) as string[]);
      return { id: txnId, ref_no: row!.ref_no, duplicate: false, total, warnings };
    });
    return result;
  } catch (e) {
    // two devices syncing the same entry at the same moment: return the winner
    const pg = e as { code?: string; constraint?: string };
    if (pg.code === "23505" && pg.constraint === "transactions_idempotency_key_key") {
      const p = await q1<{ id: string; ref_no: string; total: string }>(
        `select id, ref_no, total from transactions where idempotency_key = $1`, [input.idempotency_key]);
      if (p) return { id: p.id, ref_no: p.ref_no, duplicate: true, total: num(p.total), warnings: [] };
    }
    throw e;
  }
}

/** Void = reverse the journal and the stock movements. Nothing is deleted. Owner only. */
export async function voidTransaction(id: string, reason: string, user: SessionUser) {
  if (user.role !== "owner") throw new HttpError(403, "Only the owner can void transactions");
  if (!reason.trim()) throw new HttpError(400, "Give a reason");
  await tx(async (c) => {
    const t = await q1<{ id: string; status: string; type: string; ref_no: string; txn_date: string }>(
      `select id, status, type, ref_no, txn_date::text from transactions where id = $1 for update`, [id], c);
    if (!t) throw new HttpError(404, "Transaction not found");
    if (t.status === "void") throw new HttpError(400, "Already void");

    const entries = await q<{ id: string }>(
      `select id from journal_entries where txn_id = $1 and not is_reversal`, [id], c);
    for (const e of entries) {
      const ls = await q<{ account_id: number; party_id: string | null; debit: string; credit: string }>(
        `select account_id, party_id, debit, credit from journal_lines where entry_id = $1`, [e.id], c);
      await writeJournal(c, id, t.txn_date, `void ${t.ref_no}: ${reason}`,
        ls.map((l) => ({ account_id: l.account_id, party_id: l.party_id, debit: num(l.credit), credit: num(l.debit) })), true);
    }
    const moves = await q<{ product_id: string; qty_change: string; unit_cost: string }>(
      `select product_id, qty_change, unit_cost from stock_movements where txn_id = $1`, [id], c);
    for (const m of moves) {
      await q(`insert into stock_movements (product_id, txn_id, qty_change, unit_cost, reason) values ($1,$2,$3,$4,'void')`,
        [m.product_id, id, -num(m.qty_change), m.unit_cost], c);
      await q(`update products set qty_on_hand = qty_on_hand - $2, updated_at = now() where id = $1`,
        [m.product_id, num(m.qty_change)], c);
    }
    await q(`update transactions set status = 'void', void_reason = $2, voided_at = now(), voided_by = $3 where id = $1`,
      [id, reason, user.id], c);
    await audit(user.id, "void", "transaction", id, { ref_no: t.ref_no, reason }, c);
    await enqueueTxnSync(c, id, t.type as TxnType, moves.map((m) => m.product_id));
  });
}
