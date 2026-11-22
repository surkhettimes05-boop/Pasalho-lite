import { getCurrentUser } from "@/lib/auth/current-user";
import { AuthorizationError } from "@/lib/auth/authorization";
import { BusinessError } from "@/lib/business-error";
import { ZodError } from "zod";

export async function requireOfflineApiUser(request: Request, mutation = false) {
  if (mutation) {
    const origin = request.headers.get("origin");
    if (!origin || new URL(origin).host !== request.headers.get("host")) {
      throw new BusinessError("INVALID_ORIGIN", "Cross-origin offline POS request denied.");
    }
  }
  const user = await getCurrentUser();
  if (!user) throw new BusinessError("UNAUTHENTICATED", "Sign in to synchronize or provision a terminal.");
  return user;
}

export function offlineApiError(error: unknown) {
  if (error instanceof AuthorizationError) return Response.json({ ok: false, code: error.code }, { status: 403 });
  if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ ok: false, code: "INVALID_OFFLINE_INPUT" }, { status: 422 });
  if (error instanceof BusinessError) {
    return Response.json({ ok: false, code: error.code }, { status: error.code === "UNAUTHENTICATED" ? 401 : error.code === "UNAUTHORIZED_ACTION" ? 403 : 422 });
  }
  console.error(JSON.stringify({ operation: "offline-pos-api", errorCategory: error instanceof Error ? error.name : "UNKNOWN" }));
  return Response.json({ ok: false, code: "OFFLINE_API_FAILED" }, { status: 503 });
}
