import "server-only";
import { q, q1, num } from "./db";
import { r2 } from "./money";

/** Sum of (debit - credit) per account system_key / type for a date range, from the journal. */
async function accountTotals(from: string, to: string) {
  return q<{ id: number; code: string; name: string; type: string; system_key: string | null; dr: string; cr: string }>(
    `select a.id, a.code, a.name, a.type, a.system_key,
            coalesce(sum(jl.debit),0) dr, coalesce(sum(jl.credit),0) cr
       from accounts a
       left join journal_lines jl on jl.account_id = a.id
       left join journal_entries je on je.id = jl.entry_id
      where je.id is null or je.entry_date between $1 and $2
      group by a.id order by a.code`,
    [from, to],
  );
}

export type Summary = {
  from: string; to: string;
  sales: number; sales_returns: number; net_sales: number; sales_vat: number; sales_gross: number; sales_count: number;
  cogs: number; gross_profit: number;
  purchases: number; purchases_gross: number; purchase_count: number;
  expenses: number; expenses_gross: number; expense_count: number;
  other_costs: number; other_income: number; net_profit: number;
  vat_output: number; vat_input: number;
};

export async function periodSummary(from: string, to: string): Promise<Summary> {
  const rows = await accountTotals(from, to);
  const by = (k: string) => rows.find((r) => r.system_key === k);
  const credit = (k: string) => { const r = by(k); return r ? num(r.cr) - num(r.dr) : 0; };
  const debit = (k: string) => { const r = by(k); return r ? num(r.dr) - num(r.cr) : 0; };
  const sales = credit("sales_goods") + credit("sales_services");
  const returns = debit("sales_returns");
  const cogs = debit("cogs");
  const otherIncome = credit("other_income");
  const expenseRows = rows.filter((r) => r.type === "expense" && r.system_key !== "cogs");
  const opex = expenseRows.filter((r) => r.system_key !== "stock_adjustment" && r.system_key !== "nonstock_purchases")
    .reduce((s, r) => s + num(r.dr) - num(r.cr), 0);
  const otherCosts = debit("stock_adjustment") + debit("nonstock_purchases");

  const t = await q<{ type: string; n: string; net: string; vat: string; gross: string }>(
    `select type, count(*) n, coalesce(sum(subtotal),0) net, coalesce(sum(vat_amount),0) vat, coalesce(sum(total),0) gross
       from transactions where status = 'posted' and txn_date between $1 and $2 group by type`,
    [from, to],
  );
  const T = (k: string) => t.find((x) => x.type === k);
  const netSales = sales - returns;
  const grossProfit = netSales - cogs;
  return {
    from, to,
    sales: r2(sales), sales_returns: r2(returns), net_sales: r2(netSales),
    sales_vat: r2(num(T("sale")?.vat) - num(T("sale_return")?.vat)),
    sales_gross: r2(num(T("sale")?.gross) - num(T("sale_return")?.gross)),
    sales_count: num(T("sale")?.n),
    cogs: r2(cogs), gross_profit: r2(grossProfit),
    purchases: r2(num(T("purchase")?.net) - num(T("purchase_return")?.net)),
    purchases_gross: r2(num(T("purchase")?.gross) - num(T("purchase_return")?.gross)),
    purchase_count: num(T("purchase")?.n),
    expenses: r2(opex), expenses_gross: r2(num(T("expense")?.gross)), expense_count: num(T("expense")?.n),
    other_costs: r2(otherCosts), other_income: r2(otherIncome),
    net_profit: r2(grossProfit + otherIncome - opex - otherCosts),
    vat_output: r2(credit("vat_output")), vat_input: r2(debit("vat_input")),
  };
}

export type Balances = { cash: number; bank: number; receivable: number; payable: number; inventory: number; vat_payable: number };

export async function balances(asOf: string): Promise<Balances> {
  const rows = await q<{ system_key: string; bal: string }>(
    `select a.system_key, coalesce(sum(jl.debit - jl.credit),0) bal
       from accounts a join journal_lines jl on jl.account_id = a.id
       join journal_entries je on je.id = jl.entry_id
      where a.system_key in ('cash','bank','ar','ap','inventory','vat_output','vat_input') and je.entry_date <= $1
      group by a.system_key`,
    [asOf],
  );
  const b = (k: string) => num(rows.find((r) => r.system_key === k)?.bal);
  return {
    cash: r2(b("cash")), bank: r2(b("bank")), receivable: r2(b("ar")), payable: r2(-b("ap")),
    inventory: r2(b("inventory")), vat_payable: r2(-b("vat_output") - b("vat_input")),
  };
}

export async function dailySeries(from: string, to: string) {
  return (await q<{ d: string; sales: string; cogs: string; purchases: string; expenses: string; other: string }>(
    `with days as (select generate_series($1::date, $2::date, '1 day')::date d),
     j as (
       select je.entry_date d, a.system_key, a.type, a.is_expense_category, sum(jl.debit) dr, sum(jl.credit) cr
         from journal_lines jl join journal_entries je on je.id = jl.entry_id join accounts a on a.id = jl.account_id
        where je.entry_date between $1 and $2 group by 1,2,3,4),
     t as (select txn_date d, sum(case when type='purchase' then subtotal when type='purchase_return' then -subtotal else 0 end) purchases
             from transactions where status='posted' and txn_date between $1 and $2 group by 1)
     select days.d::text d,
       coalesce(sum(case when j.system_key in ('sales_goods','sales_services') then j.cr - j.dr
                         when j.system_key = 'sales_returns' then j.cr - j.dr else 0 end),0) sales,
       coalesce(sum(case when j.system_key = 'cogs' then j.dr - j.cr else 0 end),0) cogs,
       coalesce(max(t.purchases),0) purchases,
       coalesce(sum(case when j.is_expense_category then j.dr - j.cr else 0 end),0) expenses,
       coalesce(sum(case when j.system_key in ('stock_adjustment','nonstock_purchases') then j.dr - j.cr
                         when j.system_key = 'other_income' then j.dr - j.cr else 0 end),0) other
       from days left join j on j.d = days.d left join t on t.d = days.d
      group by days.d order by days.d`,
    [from, to],
  )).map((r) => {
    const sales = num(r.sales), cogs = num(r.cogs), exp = num(r.expenses), other = num(r.other);
    return { date: r.d, sales: r2(sales), cogs: r2(cogs), purchases: r2(num(r.purchases)), expenses: r2(exp), profit: r2(sales - cogs - exp - other) };
  });
}

export async function monthlySeries(from: string, to: string) {
  const days = await dailySeries(from, to);
  const m = new Map<string, { month: string; sales: number; cogs: number; purchases: number; expenses: number; profit: number }>();
  for (const d of days) {
    const k = d.date.slice(0, 7);
    const cur = m.get(k) ?? { month: k, sales: 0, cogs: 0, purchases: 0, expenses: 0, profit: 0 };
    cur.sales += d.sales; cur.cogs += d.cogs; cur.purchases += d.purchases; cur.expenses += d.expenses; cur.profit += d.profit;
    m.set(k, cur);
  }
  return [...m.values()].map((x) => ({ ...x, sales: r2(x.sales), cogs: r2(x.cogs), purchases: r2(x.purchases), expenses: r2(x.expenses), profit: r2(x.profit) }));
}

export async function findProducts(query: string, limit = 5) {
  return q<{ id: string; name: string; unit: string; is_service: boolean; selling_price: string; purchase_price: string;
             avg_cost: string; qty_on_hand: string; reorder_level: string; category: string | null; sim: number }>(
    `select p.id, p.name, p.unit, p.is_service, p.selling_price, p.purchase_price, p.avg_cost, p.qty_on_hand, p.reorder_level,
            c.name category,
            greatest(similarity(p.name, $1), coalesce((select max(similarity(a, $1)) from unnest(p.aliases) a), 0)) sim
       from products p left join categories c on c.id = p.category_id
      where p.active and (p.name ilike '%' || $1 || '%' or similarity(p.name, $1) > 0.2
             or exists (select 1 from unnest(p.aliases) a where a ilike '%' || $1 || '%' or similarity(a, $1) > 0.3))
      order by sim desc, p.name limit $2`,
    [query, limit],
  );
}

export async function productStats(productIds: string[], from: string, to: string) {
  if (productIds.length === 0) return [];
  return q<{ product_id: string; qty_sold: string; sales_net: string; cogs: string; qty_returned: string; qty_purchased: string;
             purchase_net: string; last_purchase_price: string | null; last_purchase_date: string | null }>(
    `select p.id product_id,
       coalesce(sum(case when t.type='sale' then tl.qty end),0) qty_sold,
       coalesce(sum(case when t.type='sale' then tl.net_amount when t.type='sale_return' then -tl.net_amount end),0) sales_net,
       coalesce(sum(case when t.type='sale' then tl.cogs_amount when t.type='sale_return' then -tl.cogs_amount end),0) cogs,
       coalesce(sum(case when t.type='sale_return' then tl.qty end),0) qty_returned,
       coalesce(sum(case when t.type='purchase' then tl.qty end),0) qty_purchased,
       coalesce(sum(case when t.type='purchase' then tl.net_amount end),0) purchase_net,
       (select tl2.unit_price from transaction_lines tl2 join transactions t2 on t2.id = tl2.txn_id
         where tl2.product_id = p.id and t2.type='purchase' and t2.status='posted' order by t2.txn_date desc, t2.created_at desc limit 1) last_purchase_price,
       (select t2.txn_date::text from transaction_lines tl2 join transactions t2 on t2.id = tl2.txn_id
         where tl2.product_id = p.id and t2.type='purchase' and t2.status='posted' order by t2.txn_date desc, t2.created_at desc limit 1) last_purchase_date
     from products p
     left join transaction_lines tl on tl.product_id = p.id
     left join transactions t on t.id = tl.txn_id and t.status='posted' and t.txn_date between $2 and $3
    where p.id = any($1::uuid[]) group by p.id`,
    [productIds, from, to],
  );
}

export async function lowStock() {
  return q<{ id: string; name: string; unit: string; qty_on_hand: string; reorder_level: string }>(
    `select id, name, unit, qty_on_hand, reorder_level from products
      where active and not is_service and qty_on_hand <= reorder_level order by qty_on_hand - reorder_level, name`,
  );
}

export async function stockValuation() {
  return q<{ id: string; name: string; category: string | null; unit: string; qty_on_hand: string; avg_cost: string;
             selling_price: string; value: string; retail_value: string }>(
    `select p.id, p.name, c.name category, p.unit, p.qty_on_hand, p.avg_cost, p.selling_price,
            round(greatest(p.qty_on_hand,0) * p.avg_cost, 2) value, round(greatest(p.qty_on_hand,0) * p.selling_price, 2) retail_value
       from products p left join categories c on c.id = p.category_id
      where p.active and not p.is_service order by c.name nulls last, p.name`,
  );
}

export async function partyBalances(kind: "supplier" | "customer", asOf: string) {
  const key = kind === "customer" ? "ar" : "ap";
  return (await q<{ id: string; name: string; phone: string | null; bal: string; last_date: string | null }>(
    `select p.id, p.name, p.phone, coalesce(sum(jl.debit - jl.credit),0) bal,
            (select max(txn_date)::text from transactions t where t.party_id = p.id and t.status='posted') last_date
       from parties p
       left join journal_lines jl on jl.party_id = p.id
            and jl.account_id = (select id from accounts where system_key = $2)
            and jl.entry_id in (select id from journal_entries where entry_date <= $3)
      where p.kind = $1 group by p.id order by p.name`,
    [kind, key, asOf],
  )).map((r) => ({ ...r, balance: r2(kind === "customer" ? num(r.bal) : -num(r.bal)) }));
}

export async function expensesByCategory(from: string, to: string) {
  return (await q<{ code: string; name: string; amt: string }>(
    `select a.code, a.name, coalesce(sum(jl.debit - jl.credit),0) amt
       from journal_lines jl join journal_entries je on je.id = jl.entry_id join accounts a on a.id = jl.account_id
      where a.is_expense_category and je.entry_date between $1 and $2
      group by a.code, a.name having sum(jl.debit - jl.credit) <> 0 order by amt desc`,
    [from, to],
  )).map((r) => ({ code: r.code, name: r.name, amount: r2(num(r.amt)) }));
}

export async function topProducts(from: string, to: string, by: "profit" | "revenue" | "qty" = "profit", limit = 10) {
  const order = by === "qty" ? "qty" : by === "revenue" ? "revenue" : "profit";
  return (await q<{ id: string; name: string; unit: string; qty: string; revenue: string; cogs: string; profit: string }>(
    `select p.id, coalesce(p.name, tl.description) name, p.unit,
            sum(case when t.type='sale' then tl.qty else -tl.qty end) qty,
            sum(case when t.type='sale' then tl.net_amount else -tl.net_amount end) revenue,
            sum(case when t.type='sale' then tl.cogs_amount else -tl.cogs_amount end) cogs,
            sum(case when t.type='sale' then tl.net_amount - tl.cogs_amount else -(tl.net_amount - tl.cogs_amount) end) profit
       from transaction_lines tl join transactions t on t.id = tl.txn_id
       left join products p on p.id = tl.product_id
      where t.status='posted' and t.type in ('sale','sale_return') and t.txn_date between $1 and $2
      group by p.id, coalesce(p.name, tl.description), p.unit
      order by ${order} desc limit $3`,
    [from, to, limit],
  )).map((r) => ({ id: r.id, name: r.name, unit: r.unit, qty: num(r.qty), revenue: r2(num(r.revenue)), cogs: r2(num(r.cogs)), profit: r2(num(r.profit)) }));
}

export type TxnFilter = {
  from: string; to: string; type?: string | null; q?: string | null; party_id?: string | null;
  product_id?: string | null; include_void?: boolean; limit?: number; offset?: number;
};

export async function listTransactions(f: TxnFilter) {
  return q<{ id: string; ref_no: string; type: string; txn_date: string; party: string | null; payment_method: string;
             subtotal: string; vat_amount: string; total: string; amount_paid: string; status: string; source: string;
             items: string | null; invoice_no: string | null; notes: string | null; created_by: string | null; created_at: string;
             expense_account: string | null }>(
    `select t.id, t.ref_no, t.type, t.txn_date::text, p.name party, t.payment_method, t.subtotal, t.vat_amount, t.total,
            t.amount_paid, t.status, t.source, t.invoice_no, t.notes, u.name created_by, t.created_at::text, a.name expense_account,
            (select string_agg(tl.description || ' × ' || trim(to_char(tl.qty, 'FM999999990.###')) || coalesce(' ' || tl.unit, ''), ', ' order by tl.line_no)
               from transaction_lines tl where tl.txn_id = t.id) items
       from transactions t
       left join parties p on p.id = t.party_id
       left join users u on u.id = t.created_by
       left join accounts a on a.id = t.expense_account_id
      where t.txn_date between $1 and $2
        and ($3::text is null or t.type = $3)
        and ($4::text is null or t.ref_no ilike '%'||$4||'%' or p.name ilike '%'||$4||'%' or t.invoice_no ilike '%'||$4||'%'
             or t.notes ilike '%'||$4||'%' or a.name ilike '%'||$4||'%'
             or exists (select 1 from transaction_lines tl where tl.txn_id = t.id and tl.description ilike '%'||$4||'%'))
        and ($5::uuid is null or t.party_id = $5)
        and ($6::uuid is null or exists (select 1 from transaction_lines tl where tl.txn_id = t.id and tl.product_id = $6))
        and ($7 or t.status = 'posted')
      order by t.txn_date desc, t.created_at desc
      limit $8 offset $9`,
    [f.from, f.to, f.type || null, f.q || null, f.party_id || null, f.product_id || null, !!f.include_void,
     Math.min(f.limit ?? 200, 5000), f.offset ?? 0],
  );
}

export async function trialBalance(from: string, to: string) {
  const rows = await q<{ id: number; code: string; name: string; type: string; dr: string; cr: string }>(
    `select a.id, a.code, a.name, a.type, coalesce(sum(jl.debit),0) dr, coalesce(sum(jl.credit),0) cr
       from accounts a join journal_lines jl on jl.account_id = a.id join journal_entries je on je.id = jl.entry_id
      where je.entry_date between $1 and $2 group by a.id order by a.code`,
    [from, to],
  );
  return rows.map((r) => {
    const bal = num(r.dr) - num(r.cr);
    return { id: r.id, code: r.code, name: r.name, type: r.type, debit: r2(bal > 0 ? bal : 0), credit: r2(bal < 0 ? -bal : 0) };
  });
}

export async function profitAndLoss(from: string, to: string) {
  const rows = await accountTotals(from, to);
  const income = rows.filter((r) => r.type === "income").map((r) => ({ code: r.code, name: r.name, amount: r2(num(r.cr) - num(r.dr)) })).filter((r) => r.amount !== 0);
  const cogs = rows.filter((r) => r.system_key === "cogs").map((r) => ({ code: r.code, name: r.name, amount: r2(num(r.dr) - num(r.cr)) })).filter((r) => r.amount !== 0);
  const expenses = rows.filter((r) => r.type === "expense" && r.system_key !== "cogs").map((r) => ({ code: r.code, name: r.name, amount: r2(num(r.dr) - num(r.cr)) })).filter((r) => r.amount !== 0);
  const ti = r2(income.reduce((s, r) => s + r.amount, 0));
  const tc = r2(cogs.reduce((s, r) => s + r.amount, 0));
  const te = r2(expenses.reduce((s, r) => s + r.amount, 0));
  return { income, cogs, expenses, total_income: ti, total_cogs: tc, gross_profit: r2(ti - tc), total_expenses: te, net_profit: r2(ti - tc - te) };
}

export async function balanceSheet(asOf: string) {
  const rows = await q<{ code: string; name: string; type: string; bal: string }>(
    `select a.code, a.name, a.type, coalesce(sum(jl.debit - jl.credit),0) bal
       from accounts a join journal_lines jl on jl.account_id = a.id join journal_entries je on je.id = jl.entry_id
      where je.entry_date <= $1 group by a.id order by a.code`,
    [asOf],
  );
  const pick = (t: string, sign: number) => rows.filter((r) => r.type === t).map((r) => ({ code: r.code, name: r.name, amount: r2(sign * num(r.bal)) })).filter((r) => r.amount !== 0);
  const assets = pick("asset", 1);
  const liabilities = pick("liability", -1);
  const equity = pick("equity", -1);
  const earnings = r2(-rows.filter((r) => r.type === "income" || r.type === "expense").reduce((s, r) => s + num(r.bal), 0));
  equity.push({ code: "—", name: "Profit to date (not yet closed)", amount: earnings });
  const ta = r2(assets.reduce((s, r) => s + r.amount, 0));
  const tl = r2(liabilities.reduce((s, r) => s + r.amount, 0));
  const te = r2(equity.reduce((s, r) => s + r.amount, 0));
  return { as_of: asOf, assets, liabilities, equity, total_assets: ta, total_liabilities: tl, total_equity: te, balanced: r2(ta - tl - te) === 0 };
}

export async function ledger(accountId: number, from: string, to: string) {
  const acc = await q1<{ code: string; name: string; type: string }>(`select code, name, type from accounts where id = $1`, [accountId]);
  const open = await q1<{ bal: string }>(
    `select coalesce(sum(jl.debit - jl.credit),0) bal from journal_lines jl join journal_entries je on je.id = jl.entry_id
      where jl.account_id = $1 and je.entry_date < $2`, [accountId, from]);
  const rows = await q<{ entry_date: string; ref_no: string; type: string; memo: string; party: string | null; debit: string; credit: string; txn_id: string }>(
    `select je.entry_date::text, t.ref_no, t.type, je.memo, p.name party, jl.debit, jl.credit, t.id txn_id
       from journal_lines jl join journal_entries je on je.id = jl.entry_id join transactions t on t.id = je.txn_id
       left join parties p on p.id = coalesce(jl.party_id, t.party_id)
      where jl.account_id = $1 and je.entry_date between $2 and $3 order by je.entry_date, je.id, jl.id`,
    [accountId, from, to],
  );
  let run = num(open?.bal);
  const opening = r2(run);
  const lines = rows.map((r) => {
    run += num(r.debit) - num(r.credit);
    return { ...r, debit: num(r.debit), credit: num(r.credit), balance: r2(run) };
  });
  return { account: acc, opening, closing: r2(run), lines };
}

/** VAT figures for preparing a return. This is a working report, not an FTA submission. */
export async function vatReport(from: string, to: string) {
  const rows = await q<{ type: string; vat_category: string; net: string; vat: string }>(
    `select t.type, tl.vat_category, coalesce(sum(tl.net_amount),0) net, coalesce(sum(tl.vat_amount),0) vat
       from transaction_lines tl join transactions t on t.id = tl.txn_id
      where t.status='posted' and t.txn_date between $1 and $2
        and t.type in ('sale','sale_return','purchase','purchase_return','expense')
      group by t.type, tl.vat_category`,
    [from, to],
  );
  const g = (types: string[], cat: string | null, f: "net" | "vat") =>
    r2(rows.filter((r) => types.includes(r.type) && (cat === null || r.vat_category === cat))
      .reduce((s, r) => s + (r.type.endsWith("_return") ? -1 : 1) * num(r[f]), 0));
  const out = {
    standard_sales: g(["sale", "sale_return"], "standard", "net"),
    standard_sales_vat: g(["sale", "sale_return"], "standard", "vat"),
    zero_rated_sales: g(["sale", "sale_return"], "zero", "net"),
    exempt_sales: g(["sale", "sale_return"], "exempt", "net"),
    standard_purchases: g(["purchase", "purchase_return", "expense"], "standard", "net"),
    standard_purchases_vat: g(["purchase", "purchase_return", "expense"], null, "vat"),
  };
  return { from, to, ...out, net_vat_payable: r2(out.standard_sales_vat - out.standard_purchases_vat) };
}

/** Cash flow from cash + bank movements, grouped by what caused them (direct method). */
export async function cashFlow(from: string, to: string) {
  const rows = await q<{ type: string; inflow: string; outflow: string }>(
    `select t.type, coalesce(sum(jl.debit),0) inflow, coalesce(sum(jl.credit),0) outflow
       from journal_lines jl join journal_entries je on je.id = jl.entry_id join transactions t on t.id = je.txn_id
       join accounts a on a.id = jl.account_id
      where a.system_key in ('cash','bank') and je.entry_date between $1 and $2 and t.type <> 'transfer'
      group by t.type order by t.type`,
    [from, to],
  );
  const open = await q1<{ bal: string }>(
    `select coalesce(sum(jl.debit - jl.credit),0) bal from journal_lines jl join journal_entries je on je.id = jl.entry_id
      join accounts a on a.id = jl.account_id where a.system_key in ('cash','bank') and je.entry_date < $1`, [from]);
  const items = rows.map((r) => ({ type: r.type, inflow: r2(num(r.inflow)), outflow: r2(num(r.outflow)), net: r2(num(r.inflow) - num(r.outflow)) }));
  const net = r2(items.reduce((s, r) => s + r.net, 0));
  return { from, to, opening: r2(num(open?.bal)), items, net_change: net, closing: r2(num(open?.bal) + net) };
}

export async function aiUsageThisMonth(monthStart: string) {
  const r = await q<{ feature: string; calls: string; cost: string; input: string; output: string }>(
    `select feature, count(*) calls, coalesce(sum(cost_usd),0) cost, coalesce(sum(input_tokens),0) input, coalesce(sum(output_tokens),0) output
       from ai_usage where created_at >= $1::date group by feature order by feature`,
    [monthStart],
  );
  return r.map((x) => ({ feature: x.feature, calls: num(x.calls), cost_usd: num(x.cost), input_tokens: num(x.input), output_tokens: num(x.output) }));
}
