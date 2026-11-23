import { listOfflineReviews, resolveOfflineSubmission } from "@/modules/offline-pos/offline-pos.service";
import { offlineApiError, requireOfflineApiUser } from "@/modules/offline-pos/route-auth";

export async function GET(request: Request) {
  try { return Response.json({ ok: true, reviews: await listOfflineReviews(await requireOfflineApiUser(request)) }); }
  catch (error) { return offlineApiError(error); }
}

export async function POST(request: Request) {
  try { return Response.json({ ok: true, ...await resolveOfflineSubmission(await requireOfflineApiUser(request, true), await request.json()) }); }
  catch (error) { return offlineApiError(error); }
}
