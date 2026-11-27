"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  LayoutDashboard, Mic, ShoppingCart, Receipt, Wallet, ScanLine, Boxes, MessageSquareText, BarChart3,
  Settings, Users, Moon, Sun, LogOut, ListOrdered, X, CloudUpload, LayoutGrid, Home, SlidersHorizontal,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { SyncBadge } from "./SyncBadge";
import { InstallApp } from "./InstallApp";
import { startSyncLoop, refreshCatalog } from "@/lib/offline/sync";

type Item = { href: string; label: string; ml?: string; icon: typeof Mic; show: boolean; color: string };

export function AppShell({ user, shopName, children }: { user: SessionUser; shopName: string; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const owner = user.role === "owner";
  const reports = owner || user.can_reports;

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    void refreshCatalog();
    const stop = startSyncLoop();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
    return stop;
  }, []);
  useEffect(() => setOpen(false), [path]);

  const items: Item[] = [
    { href: "/", label: "Home", ml: "ഹോം", icon: LayoutDashboard, show: true, color: "bg-slate-600" },
    { href: "/entry", label: "Speak an entry", ml: "പറഞ്ഞ് ചേർക്കാം", icon: Mic, show: true, color: "bg-brand-600" },
    { href: "/new/sale", label: "Sale", ml: "വിൽപ്പന", icon: ShoppingCart, show: owner || user.can_sales, color: "bg-emerald-600" },
    { href: "/new/purchase", label: "Purchase", ml: "വാങ്ങൽ", icon: Receipt, show: owner || user.can_purchases, color: "bg-sky-600" },
    { href: "/new/expense", label: "Expense", ml: "ചെലവ്", icon: Wallet, show: owner || user.can_expenses, color: "bg-amber-500" },
    { href: "/scan", label: "Scan bills", ml: "ബിൽ സ്കാൻ", icon: ScanLine, show: owner || user.can_purchases, color: "bg-violet-600" },
    { href: "/inventory", label: "Stock", ml: "സ്റ്റോക്ക്", icon: Boxes, show: true, color: "bg-orange-500" },
    { href: "/parties", label: "Customers & suppliers", ml: "കസ്റ്റമർ / സപ്ലയർ", icon: Users, show: true, color: "bg-pink-600" },
    { href: "/chat", label: "Ask AI", ml: "AI-യോട് ചോദിക്കാം", icon: MessageSquareText, show: reports, color: "bg-indigo-600" },
    { href: "/reports", label: "Reports", ml: "റിപ്പോർട്ട്", icon: BarChart3, show: reports, color: "bg-teal-600" },
    { href: "/transactions", label: "All entries", ml: "എല്ലാ എൻട്രികളും", icon: ListOrdered, show: reports, color: "bg-cyan-600" },
    { href: "/outbox", label: "Waiting to upload", ml: "അപ്‌ലോഡ് ബാക്കി", icon: CloudUpload, show: true, color: "bg-lime-600" },
    { href: "/settings", label: "Settings", ml: "സെറ്റിങ്സ്", icon: Settings, show: owner, color: "bg-slate-500" },
    { href: "/advanced", label: "Advanced", ml: "അക്കൗണ്ടന്റിന്", icon: SlidersHorizontal, show: reports, color: "bg-stone-500" },
  ];
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));

  function toggleTheme() {
    const d = !dark;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    localStorage.setItem("theme", d ? "dark" : "light");
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const nav = (
    <nav className="flex flex-col gap-0.5 p-3">
      {items.filter((i) => i.show).map((i) => (
        <Link key={i.href} href={i.href}
          className={clsx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
            active(i.href) ? "bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-100" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
          <i.icon size={18} /> {i.label}
        </Link>
      ))}
    </nav>
  );

  // phone bottom bar: the four most-used actions (the ones this user may do) + "More" for everything else
  const pick = (h: string) => items.find((i) => i.href === h && i.show);
  // Home is always first; then the two most-used entry screens this user may use (Scan bills is inside Purchase and in More)
  const bottom = [pick("/")!, ...(["/new/sale", "/new/purchase", "/new/expense", "/scan", "/inventory"] as const)
    .map(pick).filter((i): i is Item => !!i).slice(0, 2)];
  const short: Record<string, string> = { "/new/sale": "Sale", "/new/purchase": "Purchase", "/scan": "Scan", "/new/expense": "Expense", "/inventory": "Stock", "/": "Home" };
  const bar = [bottom[0], bottom[1], { href: "/entry", label: "Speak", icon: Mic, big: true }, bottom[2]].filter(Boolean) as { href: string; label: string; icon: typeof Mic; big?: boolean }[];

  const tiles = (
    <div className="grid grid-cols-3 gap-3 p-4 sm:grid-cols-4">
      {items.filter((i) => i.show).map((i) => (
        <Link key={i.href} href={i.href} onClick={() => setOpen(false)}
          className={clsx("card flex min-h-28 flex-col items-center justify-center gap-2 p-3 text-center text-[13px] font-semibold leading-tight active:scale-95",
            active(i.href) && "!border-brand-500 ring-2 ring-brand-500/30")}>
          <span className={clsx("flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-sm", i.color)}><i.icon size={26} /></span>
          <span>{i.label}{i.ml && <span className="mt-0.5 block text-[11px] font-normal text-slate-500">{i.ml}</span>}</span>
        </Link>
      ))}
      <InstallApp className="card flex min-h-28 flex-col items-center justify-center gap-2 p-3 text-center text-[13px] font-semibold leading-tight active:scale-95" />
      <button onClick={toggleTheme} className="card flex min-h-28 flex-col items-center justify-center gap-2 p-3 text-center text-[13px] font-semibold active:scale-95">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900">{dark ? <Sun size={26} /> : <Moon size={26} />}</span>
        {dark ? "Light mode" : "Dark mode"}
      </button>
      <button onClick={logout} className="card flex min-h-28 flex-col items-center justify-center gap-2 p-3 text-center text-[13px] font-semibold active:scale-95">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-600 text-white"><LogOut size={26} /></span>
        Sign out
      </button>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="no-print sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:flex">
        <div className="px-5 pb-2 pt-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Smart Shop</div>
          <div className="truncate text-lg font-bold">{shopName}</div>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="border-t border-slate-200 p-3 text-sm dark:border-slate-800">
          <div className="px-2 pb-2 text-slate-500">{user.name} · {owner ? "Owner" : "Employee"}</div>
          <div className="flex gap-1">
            <button className="btn-ghost flex-1" onClick={toggleTheme}>{dark ? <Sun size={16} /> : <Moon size={16} />} Theme</button>
            <button className="btn-ghost flex-1" onClick={logout}><LogOut size={16} /> Sign out</button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90" style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}>
          <Link href="/" className="truncate font-semibold lg:hidden">{shopName}</Link>
          <div className="ml-auto flex items-center gap-2"><SyncBadge /></div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 lg:px-8 lg:pb-10">{children}</main>

        <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="grid grid-cols-5 items-end">
            {bar.map((b) => (
              <Link key={b.href} href={b.href} className={clsx("flex flex-col items-center gap-0.5 py-2 text-xs font-semibold", active(b.href) ? "text-brand-600" : "text-slate-600 dark:text-slate-300")}>
                {b.big ? (
                  <span className="-mt-7 flex h-16 w-16 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg ring-4 ring-white dark:ring-slate-900"><b.icon size={30} /></span>
                ) : b.href === "/" ? <Home size={24} /> : <b.icon size={24} />}
                {b.big ? b.label : short[b.href] ?? b.label}
              </Link>
            ))}
            {Array.from({ length: Math.max(0, 4 - bar.length) }).map((_, k) => <span key={k} />)}
            <button onClick={() => setOpen(true)} className={clsx("flex flex-col items-center gap-0.5 py-2 text-xs font-semibold", open ? "text-brand-600" : "text-slate-600 dark:text-slate-300")}>
              <LayoutGrid size={24} /> More
            </button>
          </div>
        </nav>
      </div>

      {open && (
        <div className="no-print fixed inset-0 z-40 flex flex-col bg-slate-50 dark:bg-slate-950 lg:hidden" role="dialog" aria-label="Menu">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
            <div className="min-w-0"><div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Smart Shop</div><div className="truncate font-bold">{shopName}</div><div className="text-xs text-slate-500">{user.name} · {owner ? "Owner" : "Employee"}</div></div>
            <button className="btn-secondary px-3" onClick={() => setOpen(false)} aria-label="Close"><X size={22} /></button>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>{tiles}</div>
        </div>
      )}
    </div>
  );
}
