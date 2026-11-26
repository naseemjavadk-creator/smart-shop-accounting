"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "./ui";

type Usage = { feature: string; calls: number; cost_usd: number; input_tokens: number; output_tokens: number }[];

async function patch(body: unknown) {
  const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.ok ? null : ((await r.json()).error as string);
}

export function SettingsForms(props: {
  shop: { name: string; trn: string; address: string; phone: string };
  vat: { registered: boolean; standard_rate: number; sales_prices_include_vat: boolean; purchase_prices_include_vat: boolean };
  sheets: { spreadsheet_id: string; enabled: boolean };
  ai: { monthly_budget_usd: number };
  usage: Usage;
  sync: { pending: number; done: number; failed: number; last_error: string | null; configured: boolean };
  serviceEmail: string | null;
  features: { ai: boolean; stt: boolean; models: Record<string, string> };
}) {
  const router = useRouter();
  const [shop, setShop] = useState(props.shop);
  const [vat, setVat] = useState(props.vat);
  const [sheets, setSheets] = useState(props.sheets);
  const [budget, setBudget] = useState(props.ai.monthly_budget_usd);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [imp, setImp] = useState({ tab: "Products", kind: "products" });
  const say = (k: string, m: string) => setMsg((x) => ({ ...x, [k]: m }));

  async function save(k: string, body: unknown) { const e = await patch(body); say(k, e ?? "Saved ✓"); router.refresh(); }
  async function syncNow(full: boolean) {
    say("sheets", "Syncing…");
    const r = await fetch("/api/sheets/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full }) });
    const j = await r.json();
    say("sheets", r.ok ? (j.skipped ? j.skipped : `Synced ${j.processed} items${j.failed ? `, ${j.failed} failed (will retry)` : ""}`) : j.error);
    router.refresh();
  }
  async function runImport() {
    say("import", "Importing…");
    const r = await fetch("/api/sheets/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(imp) });
    const j = await r.json();
    say("import", r.ok ? `Added ${j.created}, skipped ${j.skipped} (already exist / empty).${j.errors?.length ? " Errors: " + j.errors.join("; ") : ""}` : j.error);
  }
  const spent = props.usage.reduce((s, u) => s + u.cost_usd, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <div className="font-semibold">Shop details</div>
        {(["name", "trn", "address", "phone"] as const).map((k) => (
          <div key={k}><label className="label">{k === "trn" ? "TRN (VAT number)" : k[0].toUpperCase() + k.slice(1)}</label>
            <input className="input" value={shop[k]} onChange={(e) => setShop({ ...shop, [k]: e.target.value })} /></div>
        ))}
        <button className="btn-primary" onClick={() => save("shop", { shop })}>Save</button> <span className="text-sm text-slate-500">{msg.shop}</span>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="font-semibold">UAE VAT</div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vat.registered} onChange={(e) => setVat({ ...vat, registered: e.target.checked })} /> Shop is VAT registered</label>
        <div><label className="label">Standard VAT rate (%)</label><input type="number" step="0.01" className="input w-32" value={vat.standard_rate} onChange={(e) => setVat({ ...vat, standard_rate: Number(e.target.value) })} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vat.sales_prices_include_vat} onChange={(e) => setVat({ ...vat, sales_prices_include_vat: e.target.checked })} /> Selling prices include VAT (usual for retail)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vat.purchase_prices_include_vat} onChange={(e) => setVat({ ...vat, purchase_prices_include_vat: e.target.checked })} /> Supplier prices include VAT</label>
        <p className="text-xs text-slate-500">Zero-rated / exempt items are set per product. Rate changes apply to new entries only. These reports help prepare returns; they are not an FTA submission.</p>
        <button className="btn-primary" onClick={() => save("vat", { vat })}>Save</button> <span className="text-sm text-slate-500">{msg.vat}</span>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="font-semibold">Google Sheets sync</div>
        {!props.sync.configured ? (
          <p className="text-sm text-amber-700">Not set up yet: add GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY on the server (see SETUP.md).</p>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">Share your Google Sheet with <b className="break-all">{props.serviceEmail}</b> as Editor, then paste its link here.</p>
        )}
        <div><label className="label">Spreadsheet link or ID</label><input className="input" value={sheets.spreadsheet_id} onChange={(e) => setSheets({ ...sheets, spreadsheet_id: e.target.value })} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sheets.enabled} onChange={(e) => setSheets({ ...sheets, enabled: e.target.checked })} /> Sync automatically</label>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => save("sheets", { sheets })}>Save</button>
          <button className="btn-secondary" onClick={() => syncNow(false)}>Sync now</button>
          <button className="btn-secondary" onClick={() => syncNow(true)}>Re-send everything</button>
        </div>
        <p className="text-sm text-slate-500">Queue: {props.sync.pending} waiting · {props.sync.done} done · {props.sync.failed} failed{props.sync.last_error ? ` · last error: ${props.sync.last_error.slice(0, 140)}` : ""}</p>
        <p className="text-sm text-slate-500">{msg.sheets}</p>
        <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="mb-2 text-sm font-medium">Import existing data from a tab (first row = headers)</div>
          <div className="flex flex-wrap gap-2">
            <input className="input w-40" value={imp.tab} onChange={(e) => setImp({ ...imp, tab: e.target.value })} placeholder="Tab name" />
            <select className="input w-auto" value={imp.kind} onChange={(e) => setImp({ ...imp, kind: e.target.value })}>
              <option value="products">Products (+ opening stock)</option><option value="customers">Customers (+ balance)</option><option value="suppliers">Suppliers (+ balance)</option>
            </select>
            <button className="btn-secondary" onClick={runImport}>Import</button>
          </div>
          <p className="mt-1 text-sm text-slate-500">{msg.import}</p>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="font-semibold">AI usage & cost (this month)</div>
        {!props.features.ai && <p className="text-sm text-amber-700">AI is off: add {props.features.models.provider === "claude" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY (free from aistudio.google.com)"} on the server. Manual entry still works.</p>}
        {props.features.models.provider === "gemini" && <p className="text-xs text-slate-500">AI service: Google Gemini. On Gemini&apos;s free tier the cost shows as 0, requests per minute and per day are limited, and Google may use what is sent (entries, bill images, questions) to improve its products. Turn on Google billing, or switch to Claude, if that matters.</p>}
        <table className="table">
          <thead><tr><th>Feature</th><th className="num">Uses</th><th className="num">Cost (USD)</th></tr></thead>
          <tbody>
            {props.usage.map((u) => <tr key={u.feature}><td className="capitalize">{u.feature === "parse" ? "Voice/text understanding" : u.feature === "ocr" ? "Bill reading" : u.feature === "stt" ? "Speech-to-text (Gemini)" : "AI chat"}</td><td className="num">{u.calls}</td><td className="num">{u.cost_usd.toFixed(4)}</td></tr>)}
            <tr className="font-semibold"><td>Total</td><td /><td className="num">{spent.toFixed(4)}</td></tr>
          </tbody>
        </table>
        <div className="flex items-end gap-2">
          <div><label className="label">Monthly AI budget (USD, 0 = no limit)</label><input type="number" step="1" className="input w-32" value={budget} onChange={(e) => setBudget(Number(e.target.value))} /></div>
          <button className="btn-primary" onClick={() => save("ai", { ai: { monthly_budget_usd: budget } })}>Save</button>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full bg-brand-600" style={{ width: `${budget ? Math.min(100, (spent / budget) * 100) : 0}%` }} /></div>
        <p className="text-xs text-slate-500">Provider: {props.features.models.provider === "claude" ? "Claude (paid)" : "Gemini"}. Models: understanding {props.features.models.parse}, bills {props.features.models.ocr}, chat {props.features.models.chat}. When the budget is used up, AI features pause and manual entry keeps working. {msg.ai}</p>
      </Card>
    </div>
  );
}

type U = { id: string; name: string; email: string; role: "owner" | "employee"; can_purchases: boolean; can_sales: boolean; can_expenses: boolean; can_reports: boolean; can_void: boolean; active: boolean; password?: string };

export function UsersAdmin({ users, meId }: { users: U[]; meId: string }) {
  const router = useRouter();
  const blank: U = { id: "", name: "", email: "", role: "employee", can_purchases: true, can_sales: true, can_expenses: false, can_reports: false, can_void: false, active: true, password: "" };
  const [edit, setEdit] = useState<U | null>(null);
  const [err, setErr] = useState("");
  async function save() {
    if (!edit) return;
    const { id, ...body } = edit;
    if (!body.password) delete body.password;
    const r = await fetch(id ? `/api/users/${id}` : "/api/users", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { const j = await r.json(); setErr(j.issues?.[0]?.message ?? j.error); return; }
    setEdit(null); setErr(""); router.refresh();
  }
  const perms = [["can_purchases", "Purchases"], ["can_sales", "Sales"], ["can_expenses", "Expenses"], ["can_reports", "Reports & AI chat"], ["can_void", "Delete entries"]] as const;
  return (
    <Card className="overflow-x-auto">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="font-semibold">Users</div>
        <button className="btn-primary py-1.5" onClick={() => setEdit(blank)}>Add employee</button>
      </div>
      {edit && (
        <div className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-4 dark:border-slate-800">
          <input className="input" placeholder="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <input className="input" placeholder="Email (login)" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
          <input className="input" type="password" placeholder={edit.id ? "New password (optional)" : "Password (8+)"} value={edit.password ?? ""} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
          <select className="input" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as U["role"] })}><option value="employee">Employee</option><option value="owner">Owner (full access)</option></select>
          <div className="flex flex-wrap gap-3 text-sm sm:col-span-4">
            {perms.map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.checked })} /> {l}</label>)}
            <label className="flex items-center gap-1"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
          </div>
          <div className="flex gap-2 sm:col-span-4"><button className="btn-primary" onClick={save}>Save</button><button className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button>{err && <span className="text-sm text-rose-600">{err}</span>}</div>
        </div>
      )}
      <table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Can do</th><th></th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id} className={u.active ? "" : "opacity-50"}>
            <td>{u.name}{u.id === meId && " (you)"}</td><td>{u.email}</td><td className="capitalize">{u.role}</td>
            <td className="text-xs">{u.role === "owner" ? "Everything" : perms.filter(([k]) => u[k]).map(([, l]) => l).join(", ")}</td>
            <td><button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEdit({ ...u, password: "" })}>Edit</button></td>
          </tr>
        ))}</tbody>
      </table>
      <p className="p-3 text-xs text-slate-500">Changing a user signs them out of all devices.</p>
    </Card>
  );
}
