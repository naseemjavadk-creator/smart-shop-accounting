import { redirect } from "next/navigation";
import { getUser, can } from "@/lib/auth";
import { Chat } from "@/components/Chat";

export default async function ChatPage() {
  if (!can(await getUser(), "reports")) redirect("/");
  return <Chat />;
}
