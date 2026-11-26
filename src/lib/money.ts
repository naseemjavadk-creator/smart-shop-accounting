export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export function aed(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return "AED " + v.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function qty(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-AE", { maximumFractionDigits: 3 });
}
