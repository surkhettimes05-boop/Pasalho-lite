import { getProvisionCandidates, provisionOfflineTerminal, renewOfflineSnapshot, revokeOfflineTerminal } from "@/modules/offline-pos/offline-pos.service";
import { offlineApiError, requireOfflineApiUser } from "@/modules/offline-pos/route-auth";

export async function GET(request: Request) {
  try {
    const actor = await requireOfflineApiUser(request);
    return Response.json({ ok: true, ...(await getProvisionCandidates(actor)) });
  }
  catch (error) { return offlineApiError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireOfflineApiUser(request, true);
    const snapshot = await provisionOfflineTerminal(actor, await request.json());
    return Response.json({ ok: true, snapshot });
  } catch (error) { return offlineApiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireOfflineApiUser(request, true);
    const { terminalId } = await request.json();
    await revokeOfflineTerminal(actor, terminalId);
    return Response.json({ ok: true });
  } catch (error) { return offlineApiError(error); }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireOfflineApiUser(request, true);
    const snapshot = await renewOfflineSnapshot(actor, await request.json());
    return Response.json({ ok: true, snapshot });
  } catch (error) { return offlineApiError(error); }
}
