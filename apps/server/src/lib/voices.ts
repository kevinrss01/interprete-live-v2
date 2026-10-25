import { rateLimit, verify, voiceGrant, voiceOwnerKey } from "./session";
import { credential } from "./config";
import { AppError, checkProvider } from "./errors";
type CreatedVoice = { voice_id: string; requires_verification?: boolean };
const jobs = new Map<string, Promise<CreatedVoice>>();

async function createOrRecoverVoice(
  owner: string,
  speaker: string,
  files: File[],
  signal: AbortSignal,
): Promise<CreatedVoice> {
  const name = `Interprete ${speaker.toUpperCase()} ${owner}`;
  const query = new URLSearchParams({
    search: name,
    page_size: "10",
    voice_type: "personal",
    include_total_count: "false",
  });
  const lookup = await fetch(`https://api.elevenlabs.io/v2/voices?${query}`, {
    headers: { "xi-api-key": credential("eleven") },
    signal,
  });
  await checkProvider(lookup, "ElevenLabs");
  const inventory = await lookup.json();
  const existing = inventory.voices?.find(
    (v: {
      voice_id?: string;
      name?: string;
      labels?: Record<string, string>;
    }) =>
      v.name === name &&
      v.labels?.owner === owner &&
      v.labels?.app === "interprete-live" &&
      v.labels?.speaker === speaker,
  );
  if (existing?.voice_id)
    return {
      voice_id: existing.voice_id,
      requires_verification: Boolean(
        existing.voice_verification?.requires_verification &&
        !existing.voice_verification?.is_verified,
      ),
    };

  const form = new FormData();
  form.set("name", name);
  form.set(
    "description",
    "Personal voice created with consent in Interprète.",
  );
  form.set("remove_background_noise", "false");
  form.set(
    "labels",
    JSON.stringify({ app: "interprete-live", speaker, owner }),
  );
  for (const [index, file] of files.entries())
    form.append(
      "files",
      file,
      `sample-${index}.${file.type.includes("mp4") ? "m4a" : file.type.includes("wav") ? "wav" : "webm"}`,
    );
  const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": credential("eleven") },
    body: form,
    signal,
  });
  if (!response.ok) {
    let detail = "";
    try {
      const value = await response.json();
      detail =
        typeof value.detail === "object"
          ? value.detail?.status || ""
          : String(value.detail || "");
    } catch {}
    if (detail.includes("voice_limit") || detail.includes("max"))
      throw new AppError(
        "VOICE_LIMIT",
        "The ElevenLabs voice limit has been reached. Free up a voice in the account to try again.",
        409,
      );
    if (response.status === 422)
      throw new AppError(
        "CLONE_SAMPLE",
        "The sample is too short or unusable. Add clear speech, then try again.",
        422,
      );
    throw new AppError(
      "CLONE_PROVIDER",
      "ElevenLabs could not create this voice. The standard voice is still available.",
      502,
    );
  }
  const result = await response.json();
  if (typeof result.voice_id !== "string") throw new Error("CLONE_RESPONSE");
  return result;
}
export async function cloneVoice(sessionId: string, request: Request) {
  rateLimit(sessionId, "clone", 4, 3600000);
  if (Number(request.headers.get("content-length")) > 3500000)
    throw new AppError(
      "UPLOAD_SIZE",
      "The audio sample is too large.",
      413,
    );
  const data = await request.formData();
  const files = data
    .getAll("files")
    .filter((f): f is File => f instanceof File);
  const speaker = data.get("speaker"),
    seconds = Number(data.get("seconds"));
  const consentId = data.get("consentId");
  if (data.get("consent") !== "true")
    throw new AppError(
      "CONSENT",
      "The person’s consent is required to create their voice.",
    );
  if (speaker !== "a" && speaker !== "b")
    throw new AppError("SPEAKER", "Invalid voice profile.");
  if (
    typeof consentId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      consentId,
    )
  )
    throw new AppError(
      "CONSENT",
      "Authorize the creation of this voice again.",
    );
  if (
    !files.length ||
    files.length > 12 ||
    files.reduce((n, f) => n + f.size, 0) > 3200000 ||
    files.some((f) => !f.type.startsWith("audio/") || !f.size)
  )
    throw new AppError(
      "AUDIO",
      "Send an audio sample smaller than 3 MB.",
    );
  if (!Number.isFinite(seconds) || seconds < 10 || seconds > 90)
    throw new AppError(
      "AUDIO_LENGTH",
      "At least 10 seconds of speech are required.",
    );
  const owner = voiceOwnerKey(sessionId, speaker, consentId);
  let job = jobs.get(owner);
  if (!job) {
    job = createOrRecoverVoice(
      owner,
      speaker,
      files,
      AbortSignal.any([request.signal, AbortSignal.timeout(50000)]),
    );
    jobs.set(owner, job);
  }
  let result: CreatedVoice;
  try {
    result = await job;
  } finally {
    if (jobs.get(owner) === job) jobs.delete(owner);
  }
  return {
    voice: voiceGrant(sessionId, speaker, result.voice_id),
    label: "Your voice",
    requiresVerification: Boolean(result.requires_verification),
  };
}
export async function deleteVoice(
  sessionId: string,
  voice: string,
  speaker: "a" | "b",
) {
  const grant = verify(voice);
  if (
    !grant ||
    grant.id !== sessionId ||
    grant.speaker !== speaker ||
    grant.purpose !== "voice" ||
    !grant.voiceId
  )
    throw new AppError(
      "VOICE",
      "This voice cannot be deleted.",
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
}
