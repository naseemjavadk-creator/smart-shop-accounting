import { notFound } from "next/navigation";
import { NewEntry } from "@/components/NewEntry";
import type { TxnKind } from "@/lib/offline/types";

const TYPES: TxnKind[] = ["sale", "purchase", "expense", "receipt", "payment", "sale_return", "purchase_return", "stock_adjustment", "transfer"];

export default async function NewPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!TYPES.includes(type as TxnKind)) notFound();
  return <NewEntry type={type as TxnKind} />;
}
