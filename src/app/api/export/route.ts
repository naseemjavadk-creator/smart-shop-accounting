import { handle } from "@/lib/api";
import { requireUser, HttpError } from "@/lib/auth";
import { dataset, toCsv, toPdf, toXlsx, REPORTS, type ReportName } from "@/lib/export";
import { isISODate, rangeFor, type RangeKey } from "@/lib/dates";
import { audit } from "@/lib/audit";

export const maxDuration = 60;

export const GET = handle(async (req: Request) => {
  const user = await requireUser("reports");
  const u = new URL(req.url);
  const report = u.searchParams.get("report") as ReportName;
  if (!REPORTS.includes(report)) throw new HttpError(400, "Unknown report");
  const fmt = u.searchParams.get("format") ?? "xlsx";
  const r = rangeFor((u.searchParams.get("range") as RangeKey) || "custom",
    isISODate(u.searchParams.get("from")) ? u.searchParams.get("from")! : undefined,
    isISODate(u.searchParams.get("to")) ? u.searchParams.get("to")! : undefined);
  const d = await dataset(report, r.from, r.to);
  const name = `${report}_${r.from}_${r.to}`;
  await audit(user.id, "export", report, null, { from: r.from, to: r.to, fmt });
  if (fmt === "csv")
    return new Response(toCsv(d), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
  if (fmt === "pdf")
    return new Response(new Uint8Array(await toPdf(d)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}.pdf"` } });
  return new Response(new Uint8Array(await toXlsx(d)), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` },
  });
});
