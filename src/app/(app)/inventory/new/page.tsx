import { q } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ProductForm } from "@/components/ProductForm";

export default async function NewProduct() {
  const cats = await q<{ id: number; name: string }>(`select id, name from categories order by name`);
  return <div className="mx-auto max-w-3xl"><PageHeader title="Add product" /><ProductForm cats={cats} /></div>;
}
