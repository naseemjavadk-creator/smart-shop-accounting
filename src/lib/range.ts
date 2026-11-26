import { rangeFor, isISODate, type RangeKey } from "./dates";

type SP = Record<string, string | string[] | undefined>;
export function rangeFromSearch(sp: SP, def: RangeKey = "this_month") {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const key = (s("range") as RangeKey) || def;
  return rangeFor(key, isISODate(s("from")) ? s("from") : undefined, isISODate(s("to")) ? s("to") : undefined);
}
export const str = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
