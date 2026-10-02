"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticateCredentials } from "@/lib/auth/service";
import {
  clearLoginFailures,
  checkLoginRateLimit,
  getLoginRateLimitKey,
  recordLoginFailure,
} from "@/lib/auth/login-rate-limit";
import {
  createSession,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { env } from "@/lib/env";
import { writeOperationLog } from "@/lib/operation-log";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(256),
});

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const requestHeaders = await headers();
  const requestId = requestHeaders.get("x-request-id");
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip");
  const email = parsed.success ? parsed.data.email : "invalid-input";
  const rateKey = getLoginRateLimitKey(email, ip);
  const limit = checkLoginRateLimit(rateKey);

  if (!limit.allowed) {
    writeOperationLog({
      requestId,
      operation: "AUTH_LOGIN",
      status: "failure",
      errorCategory: "RATE_LIMITED",
    });
    redirect("/login?error=rate_limited");
  }

  if (!parsed.success) {
    recordLoginFailure(rateKey);
    writeOperationLog({
      requestId,
      operation: "AUTH_LOGIN",
      status: "failure",
      errorCategory: "INVALID_INPUT",
    });
    redirect("/login?error=invalid");
  }

  const user = await authenticateCredentials(
    parsed.data.email,
    parsed.data.password,
  );

  if (!user) {
    recordLoginFailure(rateKey);
    writeOperationLog({
      requestId,
      operation: "AUTH_LOGIN",
      status: "failure",
      errorCategory: "INVALID_CREDENTIALS",
    });
    redirect("/login?error=invalid");
  }

  clearLoginFailures(rateKey);
  const { token, expiresAt } = await createSession(user.id);
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.APP_ENV === "production" || env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });

  writeOperationLog({
    requestId,
    operation: "AUTH_LOGIN",
    actorId: user.id,
    entityId: user.id,
    status: "success",
  });

  redirect("/");
}
