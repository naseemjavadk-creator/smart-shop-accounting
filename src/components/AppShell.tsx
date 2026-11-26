"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  LayoutDashboard, Mic, ShoppingCart, Receipt, Wallet, ScanLine, Boxes, MessageSquareText, BarChart3,
  Settings, Users, Moon, Sun, LogOut, ListOrdered, Menu, X, CloudUpload,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { SyncBadge } from "./SyncBadge";
import { startSyncLoop, refreshCatalog } from "@/lib/offline/sync";

type Item = { href: string; label: string; icon: typeof Mic; show: boolean };

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
    { href: "/", label: "Dashboard", icon: LayoutDashboard, show: true },
    { href: "/entry", label: "Voice entry", icon: Mic, show: true },
    { href: "/new/sale", label: "Add sale", icon: ShoppingCart, show: owner || user.can_sales },
    { href: "/new/purchase", label: "Add purchase", icon: Receipt, show: owner || user.can_purchases },
    { href: "/new/expense", label: "Add expense", icon: Wallet, show: owner || user.can_expenses },
    { href: "/scan", label: "Scan bills", icon: ScanLine, show: owner || user.can_purchases },
    { href: "/inventory", label: "Inventory", icon: Boxes, show: true },
    { href: "/transactions", label: "Transactions", icon: ListOrdered, show: reports },
    { href: "/parties", label: "Customers & suppliers", icon: Users, show: true },
    { href: "/chat", label: "AI accounting chat", icon: MessageSquareText, show: reports },
    { href: "/reports", label: "Reports", icon: BarChart3, show: reports },
    { href: "/outbox", label: "Saved on this phone", icon: CloudUpload, show: true },
    { href: "/settings", label: "Settings", icon: Settings, show: owner },
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

  const bottom = [
    { href: "/", label: "Home", icon: LayoutDashboard },
    { href: "/inventory", label: "Stock", icon: Boxes },
    { href: "/entry", label: "Speak", icon: Mic, big: true },
    { href: "/scan", label: "Scan", icon: ScanLine },
    { href: reports ? "/chat" : "/outbox", label: reports ? "Ask AI" : "Saved", icon: reports ? MessageSquareText : CloudUpload },
  ];

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
          <button className="btn-ghost -ml-2 px-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu size={22} /></button>
          <div className="truncate font-semibold lg:hidden">{shopName}</div>
          <div className="ml-auto flex items-center gap-2"><SyncBadge /></div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 lg:px-8 lg:pb-10">{children}</main>

        <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="grid grid-cols-5 items-end">
            {bottom.map((b) => (
              <Link key={b.href + b.label} href={b.href} className={clsx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active(b.href) ? "text-brand-600" : "text-slate-500")}>
                {b.big ? (
                  <span className="-mt-7 flex h-16 w-16 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg ring-4 ring-white dark:ring-slate-900"><b.icon size={28} /></span>
                ) : <b.icon size={22} />}
                {b.label}
              </Link>
            ))}
          </div>
        </nav>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between px-5 pt-5">
              <div><div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Smart Shop</div><div className="font-bold">{shopName}</div></div>
              <button className="btn-ghost px-2" onClick={() => setOpen(false)}><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            <div className="flex gap-1 border-t border-slate-200 p-3 dark:border-slate-800">
              <button className="btn-ghost flex-1" onClick={toggleTheme}>{dark ? <Sun size={16} /> : <Moon size={16} />} Theme</button>
              <button className="btn-ghost flex-1" onClick={logout}><LogOut size={16} /> Sign out</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
