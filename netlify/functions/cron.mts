// Netlify scheduled function: runs the app's background worker (Google Sheets outbox + queued bill scans).
// Hourly keeps the free Neon database asleep most of the time (each wake-up uses compute hours).
export default async () => {
  const base = process.env.APP_URL || process.env.URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.log("cron: set APP_URL (or rely on Netlify's URL) and CRON_SECRET");
    return;
  }
  const res = await fetch(`${base}/api/cron`, { headers: { authorization: `Bearer ${secret}` } });
  console.log("cron:", res.status, await res.text().catch(() => ""));
};

export const config = { schedule: "@hourly" };
