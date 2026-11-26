export const TZ = "Asia/Dubai";

/** YYYY-MM-DD for "now" in the shop's time zone */
export function todayISO(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function monthStart(iso: string): string {
  return iso.slice(0, 8) + "01";
}

export function monthEnd(iso: string): string {
  const d = new Date(monthStart(iso) + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

export type RangeKey = "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "this_year" | "custom";

export function rangeFor(key: RangeKey, from?: string, to?: string): { from: string; to: string; label: string } {
  const t = todayISO();
  switch (key) {
    case "today":
      return { from: t, to: t, label: "Today" };
    case "yesterday": {
      const y = addDays(t, -1);
      return { from: y, to: y, label: "Yesterday" };
    }
    case "this_week": {
      // UAE week starts Monday
      const dow = (new Date(t + "T00:00:00Z").getUTCDay() + 6) % 7;
      return { from: addDays(t, -dow), to: t, label: "This week" };
    }
    case "this_month":
      return { from: monthStart(t), to: t, label: "This month" };
    case "last_month": {
      const lm = addDays(monthStart(t), -1);
      return { from: monthStart(lm), to: lm, label: "Last month" };
    }
    case "this_year":
      return { from: t.slice(0, 4) + "-01-01", to: t, label: "This year" };
    default:
      return { from: from || monthStart(t), to: to || t, label: "Custom" };
  }
}

export function isISODate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

export function fmtDate(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
