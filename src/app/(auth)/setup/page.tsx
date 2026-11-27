"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [f, setF] = useState({
    shop_name: "", trn: "", address: "", phone: "", company_email: "",
    vat_registered: true, vat_rate: 5, sales_prices_include_vat: true,
    name: "", email: "", password: "", password2: "", setup_code: "",
  });
  const [err, setErr] = useState("");
  const [rules, setRules] = useState<{ open: boolean; code_required: boolean } | null>(null);
  useEffect(() => { fetch("/api/auth/setup").then((r) => r.json()).then(setRules).catch(() => setRules({ open: true, code_required: false })); }, []);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.type === "number" ? Number(e.target.value) : e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.password !== f.password2) { setErr("The two passwords are different"); return; }
    setBusy(true); setErr("");
    const { password2: _, ...body } = f;
    const r = await fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) router.replace("/");
    else {
      const j = await r.json().catch(() => ({}));
      setErr(j.issues?.[0]?.message ?? j.error ?? "Sign-up failed");
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-6">
      <div>
        <h2 className="text-lg font-bold">Create your company</h2>
        <p className="text-sm text-slate-500">Free. Your company&apos;s data is private: other companies using this app cannot see it.</p>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold text-brand-700 dark:text-brand-100">1. Company details</legend>
        <div><label className="label">Company / shop name</label><input className="input" value={f.shop_name} onChange={set("shop_name")} required /></div>
        <div><label className="label">Tax Registration Number (TRN) – optional</label><input className="input" inputMode="numeric" value={f.trn} onChange={set("trn")} placeholder="15 digits, if VAT registered" /></div>
        <div><label className="label">Address – optional</label><input className="input" value={f.address} onChange={set("address")} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Phone – optional</label><input className="input" type="tel" value={f.phone} onChange={set("phone")} /></div>
          <div><label className="label">Company email – optional</label><input className="input" type="email" value={f.company_email} onChange={set("company_email")} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.vat_registered} onChange={set("vat_registered")} /> Registered for VAT</label>
        {f.vat_registered && (
          <div className="grid grid-cols-2 items-end gap-2">
            <div><label className="label">VAT rate %</label><input className="input" type="number" step="0.01" value={f.vat_rate} onChange={set("vat_rate")} /></div>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={f.sales_prices_include_vat} onChange={set("sales_prices_include_vat")} /> Shelf prices include VAT</label>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold text-brand-700 dark:text-brand-100">2. Your owner login</legend>
        <div><label className="label">Your name</label><input className="input" value={f.name} onChange={set("name")} required /></div>
        <div><label className="label">Email (this is your username)</label><input className="input" type="email" autoComplete="username" value={f.email} onChange={set("email")} required /></div>
        <div><label className="label">Password (8+ characters)</label><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={set("password")} required minLength={8} /></div>
        <div><label className="label">Password again</label><input className="input" type="password" autoComplete="new-password" value={f.password2} onChange={set("password2")} required minLength={8} /></div>
        {rules?.code_required && <div><label className="label">Sign-up code</label><input className="input" required value={f.setup_code} onChange={set("setup_code")} /></div>}
      </fieldset>

      {err && <p className="text-sm text-rose-600">{err}</p>}
      {rules && !rules.open && <p className="text-sm text-rose-600">New sign-ups are closed. Ask the app owner.</p>}
      <button className="btn-primary w-full py-3" disabled={busy || (rules ? !rules.open : false)}>{busy ? "Creating…" : "Create company"}</button>
      <p className="text-center text-sm text-slate-500">Already have an account? <Link className="text-brand-600" href="/login">Sign in</Link></p>
    </form>
  );
}
