import type { VoiceFeatures, VoiceMatch } from "@interprete/shared/contracts";
import { languageName, matchVoices, nearestMatchVoice } from "@interprete/shared/languages";
import { credential, MODELS } from "./config";
import { checkProvider } from "./errors";

// Jev picks the closest voice that reads the translation language natively, from on-device
// pitch/timbre measurements. Without Jev, the nearest pitch band is a safe, deterministic answer.
export async function matchVoice(
  features: VoiceFeatures,
  language: string,
  signal: AbortSignal,
): Promise<VoiceMatch> {
  const voices = matchVoices(language);
  try {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/evaluate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential("gateway")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELS.voiceMatching,
        state: {
          task: "Live interpretation of a remote call participant into a synthetic voice.",
          speaker: {
            ...features,
            translationLanguage: languageName(language),
          },
        },
        questions: {
          voice: {
            type: "choice",
            instructions:
              "Choose the preset voice whose perceived gender, age and pitch sound most similar to the measured speaker. Adult male speech is typically 85-155 Hz, adult female speech 165-255 Hz; 145-175 Hz is ambiguous. A wide pitch range suggests an expressive delivery, a narrow one a calm delivery. Higher brightness suggests a lighter, younger timbre.",
            criteria: Object.fromEntries(
              voices.map((voice) => [
                voice.key,
                `${voice.description}, typical pitch ${voice.pitchHz[0]}-${voice.pitchHz[1]} Hz.`,
              ]),
            ),
          },
        },
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]),
      cache: "no-store",
    });
    await checkProvider(response, "Jev");
    const result = await response.json();
    const voice = voices.find(
      (candidate) => candidate.key === result.answers?.voice?.choice,
    );
    if (!voice) throw new Error("INVALID_VOICE_CHOICE");
    return { voice: voice.key, name: voice.name, source: "jev" };
  } catch {
    if (signal.aborted) throw signal.reason;
    const voice = nearestMatchVoice(features.medianPitchHz, language);
    return { voice: voice.key, name: voice.name, source: "pitch" };
  }
}
