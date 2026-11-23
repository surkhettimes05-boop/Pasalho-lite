import { listOfflineTerminals } from "@/modules/offline-pos/offline-pos.service";
import { offlineApiError, requireOfflineApiUser } from "@/modules/offline-pos/route-auth";

export async function GET(request: Request) {
  try { return Response.json({ ok: true, terminals: await listOfflineTerminals(await requireOfflineApiUser(request)) }); }
  catch (error) { return offlineApiError(error); }
}
