import { z } from "zod";
import { session, verify } from "@/lib/server/session";
import { bodyJson, parse } from "@/lib/server/validation";
import { credential } from "@/lib/server/config";
import { AppError, checkProvider, errorResponse } from "@/lib/server/errors";
export async function POST(request: Request) {
  try {
    const s = session(request);
    const { voice, speaker } = parse(
      z.object({ voice: z.string().max(1000), speaker: z.enum(["a", "b"]) }),
      await bodyJson(request),
    );
    const grant = verify(voice);
    if (
      !grant ||
      grant.id !== s.id ||
      grant.speaker !== speaker ||
      grant.purpose !== "voice" ||
      !grant.voiceId
    )
      throw new AppError(
        "VOICE",
        "Cette voix ne peut pas être supprimée.",
        403,
      );
    const response = await fetch(
      "https://api.elevenlabs.io/v1/voices/" +
        encodeURIComponent(grant.voiceId),
      {
        method: "DELETE",
        headers: { "xi-api-key": credential("eleven") },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (response.status !== 404) await checkProvider(response, "ElevenLabs");
    return Response.json({ deleted: true });
  } catch (e) {
    return errorResponse(e);
  }
}
