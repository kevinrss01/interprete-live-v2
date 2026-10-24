import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { credential } from "./config";
import { AppError } from "./errors";
import { MATCH_VOICES, VOICE_PRESETS } from "@interprete/shared/languages";
// ponytail: Tauri origins (macOS/Linux, Windows) + Vite dev; override with ALLOWED_ORIGINS on the VPS.
export const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "tauri://localhost,http://tauri.localhost,http://localhost:1420"
)
  .split(",")
  .map((s) => s.trim());
export function allowedOrigin(origin: string | null) {
  return origin !== null && allowedOrigins.includes(origin);
}
export type Claims = {
  id: string;
  expires: number;
  purpose: "session" | "voice";
  voiceId?: string;
  speaker?: string;
};
export function sign(claims: Claims) {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return (
    body +
    "." +
    createHmac("sha256", credential("session")).update(body).digest("base64url")
  );
}
export function verify(value: string): Claims | null {
  try {
    const [body, signature, ...extra] = value.split(".");
    if (!body || !signature || extra.length) return null;
    const expected = createHmac("sha256", credential("session"))
      .update(body)
      .digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return null;
    const result = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as Claims;
    if (
      !Number.isFinite(result.expires) ||
      result.expires <= Date.now() ||
      typeof result.id !== "string" ||
      !result.id ||
      (result.purpose !== "session" && result.purpose !== "voice")
    )
      return null;
    return result;
  } catch {
    return null;
  }
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigin(origin))
    throw new AppError(
      "ORIGIN",
      "Cette demande ne provient pas de l’application.",
      403,
    );
}
export function session(request: Request) {
  checkOrigin(request);
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  const result = verify(token || "");
  if (!result || result.purpose !== "session")
    throw new AppError(
      "SESSION",
      "Recharge la page pour démarrer une nouvelle session.",
      401,
    );
  return result;
}
export function bootstrapSession(request: Request) {
  let claims: Claims | null = null;
  try {
    claims = session(request);
  } catch (e) {
    if (e instanceof AppError && e.code === "ORIGIN") throw e;
  }
  if (!claims)
    claims = {
      id: randomUUID(),
      expires: Date.now() + 30 * 86400000,
      purpose: "session",
    };
  return { claims, token: sign(claims) };
}
export function voiceGrant(id: string, speaker: string, voiceId: string) {
  return sign({
    id,
    purpose: "voice",
    speaker,
    voiceId,
    expires: Date.now() + 30 * 86400000,
  });
}
export function voiceOwnerKey(id: string, speaker: string, consentId: string) {
  return createHmac("sha256", credential("session"))
    .update(`voice:${id}:${speaker}:${consentId}`)
    .digest("hex")
    .slice(0, 24);
}
export function resolveVoice(value: string, id: string, speaker: string) {
  const preset =
    VOICE_PRESETS.find((v) => v.key === value) ??
    MATCH_VOICES.find((v) => v.key === value);
  if (preset) return preset.id;
  const c = verify(value);
  if (
    !c ||
    c.purpose !== "voice" ||
    c.id !== id ||
    c.speaker !== speaker ||
    !c.voiceId
  )
    throw new AppError(
      "VOICE",
      "Cette voix n’est plus disponible. Sélectionne une voix provisoire.",
      403,
    );
  return c.voiceId;
}
const windows = new Map<string, { count: number; end: number }>();
export function rateLimit(
  id: string,
  kind: string,
  max: number,
  windowMs = 60000,
) {
  const key = id + ":" + kind,
    now = Date.now();
  let bucket = windows.get(key);
  if (!bucket || bucket.end <= now) {
    bucket = { count: 0, end: now + windowMs };
    windows.set(key, bucket);
  }
  if (++bucket.count > max)
    throw new AppError(
      "RATE_LIMIT",
      "Trop de demandes rapprochées. Patiente quelques instants.",
      429,
    );
  if (windows.size > 2000)
    for (const [key, item] of windows) if (item.end < now) windows.delete(key);
}
