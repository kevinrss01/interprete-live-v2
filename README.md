# Interprète

Traduction vocale pour deux personnes qui parlent à tour de rôle sur **un seul appareil**. App desktop [Tauri 2](https://v2.tauri.app) (React, TypeScript, Vite, Tailwind CSS) et API [Hono](https://hono.dev) hébergée sur un VPS.

```
apps/desktop     App Tauri : front React (export statique) + coque Rust (src-tauri)
apps/server      API Hono (Node) : clés OpenAI / ElevenLabs, sessions signées, déployée en Docker
packages/shared  Types, langues et segmentation communs aux deux
scripts/         Benchmark et vérifications hors app
```

## Démarrer

Prérequis : Node 22+, pnpm, Rust ([prérequis Tauri](https://v2.tauri.app/start/prerequisites/)).

```sh
pnpm install
cp apps/server/.env.example apps/server/.env.local   # renseigner les secrets
cp apps/desktop/.env.example apps/desktop/.env.local # VITE_API_URL
pnpm dev:server    # API sur http://localhost:3035
pnpm dev:desktop   # fenêtre Tauri (Vite sur :1420)
```

Choisir les deux langues, puis utiliser le bouton de la personne qui parle. La traduction commence pendant sa prise de parole, par petits segments, sans attendre l’arrêt du micro. Le micro reste ouvert pendant les pauses et la lecture ; seul le bouton Terminer clôt son tour. Les touches **A**, **B** et **Échap** permettent aussi de piloter la session.

Le bouton d’exemple utilise un enregistrement synthétique pour tester toute la chaîne sans microphone. Il ne sert jamais au clonage.

## Architecture

Documentation détaillée, avec les diagrammes : [docs/architecture.md](docs/architecture.md).

```mermaid
flowchart LR
  Micro[Micro du navigateur] --> ASR[OpenAI · gpt-live-transcribe]
  ASR --> Text[Texte partiel et final]
  Text --> Translate[OpenAI · gpt-5.4-nano]
  Text --> Jev[Jev 1.14.0 · AI Gateway]
  Translate --> Speech[ElevenLabs Flash v2.5]
  Jev --> Buffer[Valider le prochain fragment]
  Buffer --> Speech
  Speech --> Audio[Lecture pendant la prise de parole]
  Micro -->|Avec accord, en parallèle| Clone[ElevenLabs Instant Voice Cloning]
  Clone -->|Dès le prochain segment| Speech
```

- Tauri n’embarque qu’un front statique : toute la logique serveur (clés, SSE, WebSocket ElevenLabs) vit dans `apps/server`. L’app obtient une session signée via `/api/status`, la garde dans son stockage local et l’envoie en `Authorization: Bearer`. Le serveur n’accepte que les origines de `ALLOWED_ORIGINS` (CORS dans `apps/server/src/app.ts`).
- Le front appelle l’API avec le client RPC typé de Hono (`hc<AppType>` dans `apps/desktop/src/lib/api.ts`) : les types des requêtes et réponses viennent des routes du serveur, donc modifier une route casse la compilation du desktop au lieu de casser l’app.
- La webview capture du PCM 24 kHz par trames de 20 ms et se connecte à OpenAI avec un jeton éphémère délivré par `/api/session`. La capture et la connexion commencent en parallèle ; les premières trames attendent en mémoire si la connexion n’est pas encore prête. Les clés permanentes restent sur le serveur.
- `/api/interpret` traduit en streaming et communique avec ElevenLabs par WebSocket. La réponse audio revient au navigateur en SSE.
- OpenAI utilise `gpt-live-transcribe` avec `delay: minimal`. Ses deltas sont découpés en fragments lexicaux ; Jev estime quand un fragment peut être traduit sans attendre une phrase entière. Un contexte des mots suivants aide à attendre une négation ou un nombre incomplet. Jev ne garantit ni la vérité de la transcription ni la qualité de la traduction.
- Les items ASR sont finalisés séparément toutes les 30 secondes ou à une pause, sans arrêter la capture. Les transcriptions finales sont associées à leur `item_id`. Les connexions sont renouvelées après 45 minutes avec une seconde connexion préparée en parallèle ; une reconnexion rejoue le tampon non finalisé (60 secondes maximum). Une panne plus longue est signalée.
- Chaque segment autorisé est immédiatement envoyé à la synthèse. Les paquets audio sont lus dès leur réception, dans l’ordre, alors que le micro reste ouvert. Le curseur des mots déjà prononcés évite de rejouer toute la phrase à la validation finale. La dernière portion est traduite à la fin du tour.
- L’annulation d’écho du navigateur est activée (mode `all` lorsqu’il est disponible). Son efficacité acoustique dépend du navigateur, du microphone et du volume des haut-parleurs. La collecte de clonage exclut les périodes de sortie audio et émet des petits fichiers WAV pendant que le micro continue.
- Chaque profil possède sa langue, sa voix et ses échantillons. Le clonage démarre en arrière-plan après environ 30 secondes de parole autorisée, ou manuellement à partir de 10 secondes. La voix provisoire reste disponible pendant la création ; le clone est utilisé dès le prochain segment disponible. Un clone qui demande une vérification supplémentaire n’est pas activé.
- Une nouvelle tentative de clonage recherche d’abord la voix déjà créée pour ce consentement, profil et session. Cela permet de récupérer une réponse réseau perdue sans réutiliser la voix d’une personne précédente.

Il n’y a ni base de données ni enregistrement des conversations sur le serveur de l’app. Les 30 derniers passages et les trois derniers audios de réécoute restent en mémoire dans l’onglet. Les préférences et autorisations de voix sont conservées dans ce navigateur. Les voix clonées sont hébergées chez ElevenLabs jusqu’à leur suppression ; les fournisseurs appliquent leurs propres règles de conservation aux requêtes.

## Variables serveur

| Variable | Usage |
| --- | --- |
| `INTERPRETER_OPENAI_API_KEY` | Transcription et traduction OpenAI |
| `ELEVENLABS_API_KEY` | Synthèse, inventaire, création et suppression des voix |
| `AI_GATEWAY_API_KEY` | Évaluation Jev ; la traduction finale fonctionne aussi sans ce service |
| `SESSION_SECRET` | Signature des sessions et autorisations de voix ; valeur aléatoire longue |
| `ALLOWED_ORIGINS` | Origines autorisées (défaut : `tauri://localhost`, `http://tauri.localhost`, `http://localhost:1420`) |

Côté desktop, `VITE_API_URL` (dans `apps/desktop/.env.local`) est intégré au build : le pointer vers l’URL HTTPS du VPS avant `pnpm build:desktop`.

La clé ElevenLabs doit autoriser la lecture de l’inventaire, le text-to-speech et la gestion des voix. Ne jamais préfixer ces variables par `NEXT_PUBLIC_`, les committer ou les inclure dans un rapport.

## Vérification

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build:server
pnpm build:desktop   # bundle .app / .dmg / .msi selon la plateforme
```

Les tests couvrent les signatures, la séparation des voix, le consentement, les flux incomplets, la lecture avant l’arrêt de la capture, l’absence de répétition finale et le démarrage parallèle. `pnpm exec tsx scripts/verify-live-app.ts <synthetic-24khz.wav>` teste silencieusement les vraies API, sans haut-parleur. Les anciens scripts de benchmark restent dans `scripts/` ; ils utilisent les services payants et ne sont pas exécutés par les tests de l’app.

Voir [les vérifications effectuées](docs/VALIDATION.md). Les latences de démonstration sont des observations sur quelques phrases, pas un benchmark représentatif de toutes les langues et conditions réseau.

## Déploiement

- **API (VPS)** : copier le repo et `apps/server/.env.local` sur le serveur, puis `API_DOMAIN=api.example.com docker compose up -d --build`. Caddy obtient le certificat HTTPS et relaie le SSE sans buffering ; l’image ne contient que le bundle `dist/server.cjs`. Une seule instance : les limites de requêtes sont en mémoire.
- **Desktop** : `pnpm build:desktop`. Sur macOS, `Info.plist` déclare l’usage du micro et `Entitlements.plist` l’autorise sous hardened runtime ; la signature et la notarisation se configurent à part.

Le clonage d’une voix réelle nécessite l’accord de cette personne et un échantillon propre. Les deux personnes prennent toujours la parole à tour de rôle ; seule la traduction synthétique chevauche la parole. L’identification automatique des personnes et la séparation de deux voix humaines simultanées ne sont pas prises en charge.

Références : [transcription continue OpenAI](https://developers.openai.com/api/docs/guides/realtime-transcription), [streaming ElevenLabs](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts).
