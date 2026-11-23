import { ingestOfflineSale } from "@/modules/offline-pos/offline-pos.service";
import { offlineApiError, requireOfflineApiUser } from "@/modules/offline-pos/route-auth";

export async function POST(request: Request) {
  try {
    const actor = await requireOfflineApiUser(request, true);
    const result = await ingestOfflineSale(actor, await request.json());
    return Response.json({ ok: true, ...result });
  } catch (error) { return offlineApiError(error); }
}
