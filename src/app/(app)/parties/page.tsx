import Link from "next/link";
import { partyBalances } from "@/lib/reports";
import { pageUser, can } from "@/lib/auth";
import { todayISO, fmtDate } from "@/lib/dates";
import { aed } from "@/lib/money";
import { PageHeader, Card, Empty } from "@/components/ui";
import { AddParty } from "@/components/AddParty";

export default async function PartiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = (await pageUser());
  const sp = await searchParams;
  const kind = sp.kind === "supplier" ? "supplier" : "customer";
  const rows = await partyBalances(kind, todayISO());
  const total = rows.reduce((s, r) => s + r.balance, 0);
  const fin = can(user, "reports");
  return (
    <div>
      <PageHeader title="Customers & suppliers"
        subtitle={fin ? (kind === "customer" ? `Customers owe you ${aed(total)}` : `You owe suppliers ${aed(total)}`) : undefined}
        actions={<AddParty kind={kind} />} />
      <div className="mb-4 flex gap-1.5">
        {(["customer", "supplier"] as const).map((k) => (
          <Link key={k} href={`/parties?kind=${k}`} className={`chip px-4 py-1.5 text-sm ${k === kind ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>{k === "customer" ? "Customers" : "Suppliers"}</Link>
        ))}
      </div>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? <Empty>None yet. They are added automatically when you name them in an entry.</Empty> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Phone</th><th>Last transaction</th>{fin && <th className="num">{kind === "customer" ? "They owe" : "We owe"}</th>}<th></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium"><Link className="text-brand-600" href={`/transactions?range=this_year&q=${encodeURIComponent(r.name)}`}>{r.name}</Link></td>
                <td>{r.phone ?? ""}</td><td>{r.last_date ? fmtDate(r.last_date) : ""}</td>
                {fin && <td className={`num font-semibold ${r.balance > 0 ? "text-amber-600" : ""}`}>{aed(r.balance)}</td>}
                <td className="text-right">{r.balance > 0 && <Link className="btn-secondary px-3 py-1 text-xs" href={`/new/${kind === "customer" ? "receipt" : "payment"}`}>{kind === "customer" ? "Receive" : "Pay"}</Link>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
