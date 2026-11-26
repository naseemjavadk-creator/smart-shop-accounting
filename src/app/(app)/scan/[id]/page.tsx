import { BillReview } from "@/components/BillReview";
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BillReview id={id} />;
}
