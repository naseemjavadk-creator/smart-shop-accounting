import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) {
    const any = await q1(`select 1 from users limit 1`);
    redirect(any ? "/login" : "/setup");
  }
  const shop = await getSetting("shop");
  return <AppShell user={user} shopName={shop.name}>{children}</AppShell>;
}
