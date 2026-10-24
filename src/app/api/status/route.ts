import { bootstrapSession } from "@/lib/server/session";
import { configurationStatus, MODELS } from "@/lib/server/config";
import { errorResponse } from "@/lib/server/errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { cookie } = bootstrapSession(request);
    return Response.json(
      { services: configurationStatus(), models: MODELS },
      { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
