import { z } from "zod";
import { session, rateLimit } from "@/lib/session";
import { parse, bodyJson, languageSchema } from "@/lib/validation";
import { createTranscriptionSession } from "@/lib/openai";
import { errorResponse } from "@/lib/errors";
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
