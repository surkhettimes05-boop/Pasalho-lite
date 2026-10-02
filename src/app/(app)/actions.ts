"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  deleteSession,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";

export async function logoutAction() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  await deleteSession(token);
  cookieStore.delete(SESSION_COOKIE_NAME);

  redirect("/login");
}
