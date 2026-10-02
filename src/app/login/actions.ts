"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticateCredentials } from "@/lib/auth/service";
import {
  createSession,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { env } from "@/lib/env";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect("/login?error=invalid");
  }

  const user = await authenticateCredentials(
    parsed.data.email,
    parsed.data.password,
  );

  if (!user) {
    redirect("/login?error=invalid");
  }

  const { token, expiresAt } = await createSession(user.id);
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  redirect("/");
}
