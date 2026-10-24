import { Hono } from "hono";
import { z } from "zod";
import type { Language } from "@interprete/shared/languages";
import { credential, MODELS } from "../lib/config";
import { AppError } from "../lib/errors";
import { auth, json } from "../lib/http";
import { rateLimit, resolveVoice } from "../lib/session";
import { languageSchema } from "../lib/validation";

// The sentence is fixed here, never sent by the app: the route can't be used
// to synthesize arbitrary text with someone's voice.
const PREVIEW: Record<Language, string> = {
  en: "Hi! This is my voice. From now on, I can speak every language like this.",
  fr: "Bonjour ! Voici ma voix. Désormais, je peux parler toutes les langues comme ça.",
  es: "¡Hola! Esta es mi voz. A partir de ahora, puedo hablar todos los idiomas así.",
  de: "Hallo! Das ist meine Stimme. Ab jetzt kann ich so jede Sprache sprechen.",
  it: "Ciao! Questa è la mia voce. Da adesso posso parlare ogni lingua così.",
  pt: "Olá! Esta é a minha voz. A partir de agora, posso falar todas as línguas assim.",
  nl: "Hallo! Dit is mijn stem. Vanaf nu kan ik zo elke taal spreken.",
  ja: "こんにちは！これが私の声です。これからは、どんな言語でもこの声で話せます。",
  ko: "안녕하세요! 이게 제 목소리예요. 이제 어떤 언어로든 이렇게 말할 수 있어요.",
  zh: "你好！这是我的声音。从现在起，我可以用这个声音说任何语言。",
  ar: "مرحبًا! هذا صوتي. من الآن، أستطيع التحدث بكل اللغات هكذا.",
  hi: "नमस्ते! यह मेरी आवाज़ है। अब से, मैं हर भाषा ऐसे ही बोल सकता हूँ।",
  pl: "Cześć! To mój głos. Od teraz mogę tak mówić w każdym języku.",
  ru: "Привет! Это мой голос. Теперь я могу так говорить на любом языке.",
  sv: "Hej! Det här är min röst. Från och med nu kan jag tala alla språk så här.",
  tr: "Merhaba! Bu benim sesim. Artık her dili böyle konuşabilirim.",
  uk: "Привіт! Це мій голос. Відтепер я можу так говорити будь-якою мовою.",
  vi: "Xin chào! Đây là giọng nói của tôi. Từ giờ, tôi có thể nói mọi ngôn ngữ như thế này.",
};

export const voicePreview = new Hono().post(
  "/voice/preview",
  auth,
  json(z.object({ voice: z.string().max(1000), speaker: z.enum(["a", "b"]), language: languageSchema })),
  async (c) => {
    const s = c.var.session;
    rateLimit(s.id, "preview", 20);
    const { voice, speaker, language } = c.req.valid("json");
    const voiceId = resolveVoice(voice, s.id, speaker);
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": credential("eleven"), "Content-Type": "application/json" },
        body: JSON.stringify({ text: PREVIEW[language as Language], model_id: MODELS.speech, language_code: language }),
        signal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(20000)]),
      },
    );
    if (!response.ok)
      throw new AppError("PREVIEW_PROVIDER", "ElevenLabs n’a pas pu lire cette voix.", 502);
    return c.body(await response.arrayBuffer(), 200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
  },
);
