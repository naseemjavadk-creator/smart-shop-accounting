import clsx from "clsx";
import type { ReactNode } from "react";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("card", className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "bad" | "warn" }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className={clsx("mt-1 text-xl font-bold tabular-nums sm:text-2xl",
        tone === "good" && "text-emerald-600 dark:text-emerald-400",
        tone === "bad" && "text-rose-600 dark:text-rose-400",
        tone === "warn" && "text-amber-600 dark:text-amber-400")}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-slate-500">{children}</div>;
}

const TYPE_TONE: Record<string, string> = {
  sale: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  purchase: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  expense: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  receipt: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  payment: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
};

export function TypeChip({ type, label }: { type: string; label: string }) {
  return <span className={clsx("chip", TYPE_TONE[type] ?? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300")}>{label}</span>;
}
