"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupPage() {
  const router = useRouter();
  const [f, setF] = useState({ shop_name: "", name: "", email: "", password: "", setup_code: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    setBusy(false);
    if (r.ok) router.replace("/");
    else {
      const j = await r.json().catch(() => ({}));
      setErr(j.issues?.[0]?.message ?? j.error ?? "Setup failed");
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-6">
      <div>
        <h2 className="text-lg font-bold">First-time setup</h2>
        <p className="text-sm text-slate-500">Create the owner account. You can add employees later.</p>
      </div>
      <div><label className="label">Shop name</label><input className="input" value={f.shop_name} onChange={set("shop_name")} required /></div>
      <div><label className="label">Your name</label><input className="input" value={f.name} onChange={set("name")} required /></div>
      <div><label className="label">Email</label><input className="input" type="email" value={f.email} onChange={set("email")} required /></div>
      <div><label className="label">Password (8+ characters)</label><input className="input" type="password" value={f.password} onChange={set("password")} required minLength={8} /></div>
      <div><label className="label">Setup code (only if you set SETUP_CODE)</label><input className="input" value={f.setup_code} onChange={set("setup_code")} /></div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <button className="btn-primary w-full py-3" disabled={busy}>{busy ? "Creating…" : "Create owner account"}</button>
    </form>
  );
}
