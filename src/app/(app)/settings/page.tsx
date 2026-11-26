import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { q } from "@/lib/db";
import { aiUsageThisMonth } from "@/lib/reports";
import { monthStart, todayISO } from "@/lib/dates";
import { syncStatus } from "@/lib/sheets/sync";
import { aiConfigured, MODELS } from "@/lib/ai/claude";
import { sttConfigured } from "@/lib/ai/stt";
import { PageHeader, Card } from "@/components/ui";
import { SettingsForms, UsersAdmin } from "@/components/SettingsForms";

export default async function SettingsPage() {
  const user = await getUser();
  if (user?.role !== "owner") redirect("/");
  const [shop, vat, sheets, ai, usage, sync, users, log] = await Promise.all([
    getSetting("shop"), getSetting("vat"), getSetting("sheets"), getSetting("ai"),
    aiUsageThisMonth(monthStart(todayISO())), syncStatus(),
    q(`select id, name, email, role, can_purchases, can_sales, can_expenses, can_reports, active from users order by created_at`),
    q<{ created_at: string; user_name: string | null; action: string; entity: string | null; details: unknown }>(
      `select a.created_at::text, u.name user_name, a.action, a.entity, a.details from audit_log a left join users u on u.id = a.user_id order by a.id desc limit 60`),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Owner only" />
      <SettingsForms shop={shop} vat={vat} sheets={sheets} ai={ai} usage={usage} sync={sync}
        serviceEmail={process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null}
        features={{ ai: aiConfigured(), stt: sttConfigured(), models: MODELS }} />
      <UsersAdmin users={users as never} meId={user.id} />
      <Card className="overflow-x-auto">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="font-semibold">Activity log</div>
          <a className="btn-secondary py-1.5" href="/api/backup">Download full backup (JSON)</a>
        </div>
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>{log.map((l, i) => (
            <tr key={i}><td className="whitespace-nowrap text-xs">{new Date(l.created_at).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}</td><td>{l.user_name ?? ""}</td>
              <td>{l.action} {l.entity ?? ""}</td><td className="max-w-md truncate text-xs text-slate-500">{l.details ? JSON.stringify(l.details) : ""}</td></tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}
