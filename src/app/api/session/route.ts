import { z } from "zod";
import { session, rateLimit } from "@/lib/server/session";
import { parse, bodyJson, languageSchema } from "@/lib/server/validation";
import { createTranscriptionSession } from "@/lib/server/openai";
import { errorResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const s = session(request);
    rateLimit(s.id, "session", 20);
    const data = parse(
      z.object({ language: languageSchema }),
      await bodyJson(request),
    );
    return Response.json(await createTranscriptionSession(data.language), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
