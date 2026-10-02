import { NextResponse } from "next/server";
import { Role } from "@/generated/prisma/client";
import { assertRole, AuthorizationError } from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  try {
    assertRole(user.role, [Role.OWNER_ADMIN]);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.code }, { status: 403 });
    }

    throw error;
  }

  return NextResponse.json({
    status: "ok",
    role: user.role,
  });
}
