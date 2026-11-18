import { NextRequest, NextResponse } from "next/server";
import { dispatchCreatorAttributionOutbox } from "@/modules/creator-attribution/outbox.service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron delivery is not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await dispatchCreatorAttributionOutbox(50);
  return NextResponse.json(result, { status: 200 });
}
