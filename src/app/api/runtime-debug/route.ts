import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    runtime: "cloudflare-worker",
    env: {
      NODE_ENV: typeof process.env.NODE_ENV === "string",
      APP_ENV: typeof process.env.APP_ENV === "string",
      APP_URL: typeof process.env.APP_URL === "string",
      DATABASE_URL: typeof process.env.DATABASE_URL === "string",
      AUTH_SECRET: typeof process.env.AUTH_SECRET === "string",
      SESSION_TTL_HOURS: typeof process.env.SESSION_TTL_HOURS === "string",
    },
  });
}
