import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./auth";

/** Wrap a route handler so thrown errors become clean JSON responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError)
        return NextResponse.json({ error: "Invalid input", issues: e.issues }, { status: 400 });
      const pg = e as { code?: string; constraint?: string; message?: string };
      if (pg.code === "23505") {
        const msg = pg.constraint === "transactions_supplier_invoice_uq"
          ? "This supplier bill (same invoice number) is already saved."
          : "This record already exists.";
        return NextResponse.json({ error: msg, duplicate: true }, { status: 409 });
      }
      console.error(e);
      return NextResponse.json({ error: pg.message ?? "Server error" }, { status: 500 });
    }
  };
}
