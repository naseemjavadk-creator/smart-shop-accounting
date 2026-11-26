import "server-only";
import { JWT } from "google-auth-library";

let jwt: JWT | null = null;

export function sheetsConfigured(): boolean {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

async function token(): Promise<string> {
  if (!jwt) {
    jwt = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  const t = await jwt.getAccessToken();
  if (!t.token) throw new Error("Could not get a Google access token");
  return t.token;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Sheets ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const enc = encodeURIComponent;

export const sheetsApi = {
  meta: (id: string) =>
    call<{ properties: { title: string }; sheets: { properties: { title: string; sheetId: number } }[] }>(
      "GET", `${BASE}/${id}?fields=properties.title,sheets.properties`),
  addSheets: (id: string, titles: string[]) =>
    call("POST", `${BASE}/${id}:batchUpdate`, {
      requests: titles.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })),
    }),
  get: (id: string, range: string) =>
    call<{ values?: string[][] }>("GET", `${BASE}/${id}/values/${enc(range)}?majorDimension=ROWS`),
  batchUpdate: (id: string, data: { range: string; values: (string | number)[][] }[]) =>
    call("POST", `${BASE}/${id}/values:batchUpdate`, { valueInputOption: "USER_ENTERED", data }),
  append: (id: string, range: string, values: (string | number)[][]) =>
    call("POST", `${BASE}/${id}/values/${enc(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values }),
};
