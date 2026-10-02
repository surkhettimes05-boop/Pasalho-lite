import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/client";
import { requireCurrentUser } from "@/lib/auth/current-user";

export async function requirePageRole(allowedRoles: readonly Role[]) {
  const user = await requireCurrentUser();

  if (!allowedRoles.includes(user.role)) {
    redirect("/");
  }

  return user;
}
