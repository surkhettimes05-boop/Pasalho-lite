import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getSessionUser } from "@/lib/auth/session";
import { getDashboardReport } from "@/modules/reports/report.service";
import { getNepalOperatingDateKey } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  const result: Record<string, unknown> = {
    sessionCookiePresent: false,
    sessionLookup: "not_tested",
    dashboardReport: "not_tested",
  };

  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE_NAME)?.value;
    result.sessionCookiePresent = Boolean(token);

    if (!token) {
      result.sessionLookup = "no_cookie";
      return NextResponse.json(result);
    }

    const user = await getSessionUser(token);
    result.sessionLookup = user ? "ok" : "no_user";

    if (!user) {
      return NextResponse.json(result);
    }

    try {
      await getDashboardReport(user.role, getNepalOperatingDateKey());
      result.dashboardReport = "ok";
    } catch (error) {
      result.dashboardReport = "error";
      result.dashboardErrorName =
        error instanceof Error ? error.name : "unknown";
      result.dashboardErrorMessage =
        error instanceof Error ? error.message.slice(0, 300) : "unknown";
    }

    return NextResponse.json(result);
  } catch (error) {
    result.sessionLookup = "error";
    result.sessionErrorName =
      error instanceof Error ? error.name : "unknown";
    result.sessionErrorMessage =
      error instanceof Error ? error.message.slice(0, 300) : "unknown";
    return NextResponse.json(result, { status: 500 });
  }
}
