import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getSessionUser,
  SESSION_COOKIE_NAME,
  type SessionUser,
} from "@/lib/auth/session";

export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return getSessionUser(token);
}

export async function requireCurrentUser(): Promise<SessionUser> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}
