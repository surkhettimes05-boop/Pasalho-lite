import { NextResponse } from "next/server";
import { Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [warehouse, store, owners] = await Promise.all([
      prisma.location.count({
        where: { code: "WAREHOUSE_MAIN", active: true },
      }),
      prisma.location.count({
        where: { code: "STORE_MAIN", active: true },
      }),
      prisma.user.count({
        where: { role: Role.OWNER_ADMIN, active: true },
      }),
    ]);

    const ready = warehouse === 1 && store === 1 && owners >= 1;

    return NextResponse.json(
      {
        status: ready ? "ready" : "not_ready",
        database: "ok",
        warehouse: warehouse === 1 ? "ok" : "missing",
        store: store === 1 ? "ok" : "missing",
        ownerAdmin: owners >= 1 ? "ok" : "missing",
      },
      { status: ready ? 200 : 503 },
    );
  } catch {
    return NextResponse.json(
      {
        status: "not_ready",
        database: "unavailable",
      },
      { status: 503 },
    );
  }
}
