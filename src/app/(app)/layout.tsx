import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const shop = await getSetting("shop");
  return <AppShell user={user} shopName={shop.name}>{children}</AppShell>;
}
