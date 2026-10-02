import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireCurrentUser();

  return <AppShell user={user}>{children}</AppShell>;
}
