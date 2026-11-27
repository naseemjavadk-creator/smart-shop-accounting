import Link from "next/link";
import { redirect } from "next/navigation";
import { pageUser, can } from "@/lib/auth";
import { PageHeader, Card } from "@/components/ui";

/** Everything an accountant needs, kept out of the way of everyday use. Nothing here is required for a normal day. */
export default async function AdvancedPage() {
  const user = await pageUser();
  if (!can(user, "reports")) redirect("/");
  const owner = user.role === "owner";
  const entries: [string, string, string][] = [
    ["/new/receipt", "Customer paid me", "A customer pays money they owed"],
    ["/new/payment", "I paid a supplier", "Pay money you owed a supplier"],
    ["/new/sale_return", "Customer returned goods", "Sales return / refund"],
    ["/new/purchase_return", "Returned goods to supplier", "Purchase return"],
    ["/new/stock_adjustment", "Stock correction", "Count correction, damage, expiry, own use"],
    ...(owner ? [["/new/transfer", "Cash ↔ Bank", "Move money between cash and bank"] as [string, string, string]] : []),
  ];
  const reports: [string, string, string][] = [
    ["pnl", "Profit & loss", "Income statement"],
    ["balance", "Balance sheet", "What the shop owns and owes"],
    ["cashflow", "Cash flow", "Where cash came from and went"],
    ["cash", "Cash book", "Every cash in and out"],
    ["bank", "Bank book", "Every bank in and out, with bank matching"],
    ["ledger", "General ledger", "One account in detail"],
    ["trial", "Trial balance", "Debits and credits of every account"],
    ["monthly", "Month by month", "Monthly summary table"],
  ];
  const grid = (rows: [string, string, string][], href: (k: string) => string) => (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(([k, t, d]) => (
        <Link key={k} href={href(k)} className="card p-4 hover:border-brand-500">
          <div className="font-semibold">{t}</div><div className="text-sm text-slate-500">{d}</div>
        </Link>
      ))}
    </div>
  );
  return (
    <div className="space-y-6">
      <PageHeader title="Advanced" subtitle="For the accountant. You don't need these for daily work." />
      <Card className="p-4"><div className="mb-3 font-semibold">Other entries</div>{grid(entries, (k) => k)}</Card>
      <Card className="p-4"><div className="mb-3 font-semibold">Accounting reports</div>{grid(reports, (k) => `/reports?r=${k}`)}</Card>
    </div>
  );
}
