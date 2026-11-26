import "server-only";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import * as R from "./reports";
import { num } from "./db";
import { TYPE_LABEL, type TxnType } from "./accounting/schema";
import { getSetting } from "./settings";
import { todayISO } from "./dates";

type Col = { key: string; label: string; kind?: "money" | "number" | "text" };
export type Dataset = { title: string; subtitle: string; columns: Col[]; rows: Record<string, string | number | null>[] };

export const REPORTS = ["transactions", "sales", "purchases", "expenses", "stock", "pnl", "summary", "receivables", "payables", "vat", "trial_balance", "daily"] as const;
export type ReportName = (typeof REPORTS)[number];

const money = (key: string, label: string): Col => ({ key, label, kind: "money" });

export async function dataset(report: ReportName, from: string, to: string): Promise<Dataset> {
  const sub = `${from} to ${to}`;
  switch (report) {
    case "transactions":
    case "sales":
    case "purchases":
    case "expenses": {
      const type = report === "sales" ? "sale" : report === "purchases" ? "purchase" : report === "expenses" ? "expense" : null;
      const rows = await R.listTransactions({ from, to, type, limit: 5000 });
      return {
        title: report === "transactions" ? "All transactions" : report[0].toUpperCase() + report.slice(1),
        subtitle: sub,
        columns: [
          { key: "date", label: "Date" }, { key: "ref", label: "Ref" }, { key: "type", label: "Type" },
          { key: "party", label: "Party" }, { key: "items", label: report === "expenses" ? "Category / details" : "Items" },
          { key: "payment", label: "Payment" }, money("net", "Net"), money("vat", "VAT"), money("total", "Total"),
        ],
        rows: rows.map((r) => ({
          date: r.txn_date, ref: r.ref_no, type: TYPE_LABEL[r.type as TxnType] ?? r.type, party: r.party ?? "",
          items: report === "expenses" ? [r.expense_account, r.items].filter(Boolean).join(": ") : r.items ?? r.notes ?? "",
          payment: r.payment_method, net: num(r.subtotal), vat: num(r.vat_amount), total: num(r.total),
        })),
      };
    }
    case "daily": {
      const rows = await R.dailySeries(from, to);
      return {
        title: "Daily report", subtitle: sub,
        columns: [{ key: "date", label: "Date" }, money("sales", "Net sales"), money("cogs", "Cost of goods sold"),
          money("purchases", "Purchases"), money("expenses", "Expenses"), money("profit", "Profit")],
        rows,
      };
    }
    case "stock": {
      const rows = await R.stockValuation();
      return {
        title: "Stock valuation", subtitle: `As of ${todayISO()}`,
        columns: [{ key: "name", label: "Product" }, { key: "category", label: "Category" }, { key: "unit", label: "Unit" },
          { key: "qty", label: "Qty", kind: "number" }, money("avg_cost", "Avg cost"), money("value", "Stock value"),
          money("selling_price", "Selling price"), money("retail_value", "Retail value")],
        rows: rows.map((r) => ({ name: r.name, category: r.category ?? "", unit: r.unit, qty: num(r.qty_on_hand),
          avg_cost: num(r.avg_cost), value: num(r.value), selling_price: num(r.selling_price), retail_value: num(r.retail_value) })),
      };
    }
    case "pnl": {
      const p = await R.profitAndLoss(from, to);
      const rows: Dataset["rows"] = [
        { section: "Income", name: "", amount: null },
        ...p.income.map((r) => ({ section: "", name: r.name, amount: r.amount })),
        { section: "", name: "Total income", amount: p.total_income },
        { section: "Cost of goods sold", name: "", amount: null },
        ...p.cogs.map((r) => ({ section: "", name: r.name, amount: r.amount })),
        { section: "", name: "Gross profit", amount: p.gross_profit },
        { section: "Expenses", name: "", amount: null },
        ...p.expenses.map((r) => ({ section: "", name: r.name, amount: r.amount })),
        { section: "", name: "Total expenses", amount: p.total_expenses },
        { section: "NET PROFIT", name: "", amount: p.net_profit },
      ];
      return { title: "Profit and loss", subtitle: sub, columns: [{ key: "section", label: "" }, { key: "name", label: "Account" }, money("amount", "AED")], rows };
    }
    case "summary": {
      const s = await R.periodSummary(from, to);
      const lines: [string, number][] = [
        ["Net sales (excl. VAT)", s.net_sales], ["Sales returns", s.sales_returns], ["Cost of goods sold", s.cogs],
        ["Gross profit", s.gross_profit], ["Expenses", s.expenses], ["Stock losses / non-stock purchases", s.other_costs],
        ["Other income", s.other_income], ["Net profit", s.net_profit], ["Purchases (excl. VAT)", s.purchases],
        ["VAT on sales", s.vat_output], ["VAT on purchases", s.vat_input],
      ];
      return { title: "Summary", subtitle: sub, columns: [{ key: "item", label: "Item" }, money("amount", "AED")], rows: lines.map(([item, amount]) => ({ item, amount })) };
    }
    case "receivables":
    case "payables": {
      const kind = report === "receivables" ? "customer" : "supplier";
      const rows = (await R.partyBalances(kind, to)).filter((r) => r.balance !== 0);
      return {
        title: report === "receivables" ? "Customer outstanding" : "Supplier outstanding", subtitle: `As of ${to}`,
        columns: [{ key: "name", label: kind === "customer" ? "Customer" : "Supplier" }, { key: "phone", label: "Phone" },
          { key: "last", label: "Last transaction" }, money("balance", "Balance")],
        rows: rows.map((r) => ({ name: r.name, phone: r.phone ?? "", last: r.last_date ?? "", balance: r.balance })),
      };
    }
    case "vat": {
      const v = await R.vatReport(from, to);
      const rows = [
        { item: "Standard-rated sales (net)", amount: v.standard_sales },
        { item: "VAT on standard-rated sales", amount: v.standard_sales_vat },
        { item: "Zero-rated sales", amount: v.zero_rated_sales },
        { item: "Exempt sales", amount: v.exempt_sales },
        { item: "Standard-rated purchases & expenses (net)", amount: v.standard_purchases },
        { item: "Recoverable VAT on purchases & expenses", amount: v.standard_purchases_vat },
        { item: "Net VAT payable (refundable if negative)", amount: v.net_vat_payable },
      ];
      return { title: "VAT working report", subtitle: `${sub} · For preparing the return; not an official FTA submission`, columns: [{ key: "item", label: "Item" }, money("amount", "AED")], rows };
    }
    case "trial_balance": {
      const rows = await R.trialBalance(from, to);
      return { title: "Trial balance", subtitle: sub, columns: [{ key: "code", label: "Code" }, { key: "name", label: "Account" }, money("debit", "Debit"), money("credit", "Credit")],
        rows: [...rows, { code: "", name: "Total", debit: rows.reduce((s, r) => s + r.debit, 0), credit: rows.reduce((s, r) => s + r.credit, 0) }] };
    }
  }
}

export async function toXlsx(d: Dataset): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(d.title.slice(0, 31));
  ws.addRow([d.title]).font = { bold: true, size: 14 };
  ws.addRow([d.subtitle]);
  ws.addRow([]);
  const h = ws.addRow(d.columns.map((c) => c.label));
  h.font = { bold: true };
  h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF9" } }; });
  for (const r of d.rows) ws.addRow(d.columns.map((c) => r[c.key] ?? ""));
  d.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.kind ? 14 : Math.min(50, Math.max(12, c.label.length + 4));
    if (c.kind === "money") col.numFmt = "#,##0.00";
  });
  ws.views = [{ state: "frozen", ySplit: 4 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toCsv(d: Dataset): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [d.columns.map((c) => esc(c.label)).join(","), ...d.rows.map((r) => d.columns.map((c) => esc(r[c.key])).join(","))].join("\r\n");
}

export async function toPdf(d: Dataset): Promise<Buffer> {
  const shop = await getSetting("shop");
  const doc = new jsPDF({ orientation: d.columns.length > 6 ? "landscape" : "portrait", unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text(`${shop.name} — ${d.title}`, 40, 40);
  doc.setFontSize(9);
  doc.text(d.subtitle, 40, 56);
  const fmt = (v: unknown, c: Col) =>
    v == null || v === "" ? "" : c.kind === "money" ? Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
  autoTable(doc, {
    startY: 68,
    head: [d.columns.map((c) => c.label)],
    body: d.rows.map((r) => d.columns.map((c) => fmt(r[c.key], c))),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [37, 99, 235] },
    columnStyles: Object.fromEntries(d.columns.map((c, i) => [i, c.kind ? { halign: "right" as const } : {}])),
  });
  return Buffer.from(doc.output("arraybuffer"));
}
