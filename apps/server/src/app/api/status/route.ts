import { bootstrapSession } from "@/lib/session";
import { configurationStatus, MODELS } from "@/lib/config";
import { errorResponse } from "@/lib/errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { token } = bootstrapSession(request);
    return Response.json(
      { services: configurationStatus(), models: MODELS, session: token },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
