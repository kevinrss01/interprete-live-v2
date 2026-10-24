# Interprète

Traduction vocale en conversation ou pendant un appel sur Mac.

À l’ouverture, l’accueil propose deux choix : **Conversation** (deux personnes, un appareil) ou **Réunion en ligne**. Le mode **Réunion en ligne** détecte les applications qui utilisent le microphone et propose un toast de confirmation : sous-titres en direct de vos interlocuteurs en bas de l’écran (cochés par défaut), lecture de leur traduction avec une voix proche choisie par Jev, et traduction de votre micro vers un microphone virtuel BlackHole. Un mode casque et un exemple synthétique permettent de tester sans réunion. Voir [le guide de test et de configuration](docs/CALL-MODE.md).

Le mode conversation permet la traduction vocale pour deux personnes qui parlent à tour de rôle sur **un seul appareil**. App desktop [Tauri 2](https://v2.tauri.app) (React, TypeScript, Vite, Tailwind CSS) et API [Hono](https://hono.dev) hébergée sur un VPS.

```
apps/desktop     App Tauri : front React (export statique) + coque Rust (src-tauri)
apps/server      API Hono (Node) : clés OpenAI / ElevenLabs, sessions signées, déployée en Docker
apps/landing     Landing page statique (Vite), déployée sur Vercel
packages/shared  Types, langues et segmentation communs aux deux
packages/ui      Design system : composants shadcn, tokens CSS, logos
scripts/         Benchmark et vérifications hors app
```

## Démarrer

Prérequis : Node 22+, pnpm, Docker démarré (avec Compose), Rust ([prérequis Tauri](https://v2.tauri.app/start/prerequisites/)).

```sh
pnpm install
cp apps/server/.env.example apps/server/.env.local   # renseigner les secrets
cp apps/desktop/.env.example apps/desktop/.env.local # VITE_API_URL
pnpm dev          # PostgreSQL + migrations + API + Studio + app macOS Tauri
```

Après la première configuration, `pnpm dev` suffit à tout lancer depuis la racine du dépôt. Le backend est accessible sur `http://localhost:3035`, Vite sur `http://localhost:1420` et Studio sur https://local.drizzle.studio. `Ctrl+C` arrête les processus de développement et le conteneur PostgreSQL, en conservant son volume et les données. Les commandes `pnpm dev:server` et `pnpm dev:desktop` restent disponibles pour démarrer chaque partie séparément ; `pnpm --filter @interprete/desktop dev:web` lance uniquement Vite.

Choisir les deux langues, puis appuyer sur **Activer le micro** pour la personne qui parle, depuis **Conversation**. L’état du micro reste visible au-dessus des commandes. La traduction commence pendant sa prise de parole, par petits segments, sans attendre l’arrêt du micro. Le micro reste ouvert pendant les pauses et la lecture ; **Couper le micro** clôt son tour. Les touches **A**, **B** et **Échap** permettent aussi de piloter la session.

Le bouton d’exemple utilise un enregistrement synthétique pour tester toute la chaîne sans microphone. Il ne sert jamais au clonage. Une pastille ovale à droite de l’écran indique la session en cours et permet de l’arrêter depuis n’importe quelle application. **Réunion en ligne → Essayer sans appel → Tester la pastille** affiche son aperçu sans ouvrir le micro.

Si la création de compte échoue en local, vérifiez `DATABASE_URL`, `BETTER_AUTH_URL` et `BETTER_AUTH_SECRET` dans `apps/server/.env.local` (y compris dans chaque nouveau worktree). Le secret doit faire au moins 32 caractères ; générez-le une seule fois avec `openssl rand -base64 32`. `pnpm dev` et `pnpm dev:server` vérifient cette configuration avant de démarrer les services. Après une modification du fichier, relancez le serveur pour qu’il recharge les variables.

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

Le serveur dispose d’un socle PostgreSQL + Drizzle pour les comptes Better Auth et les préférences, exposé par oRPC. Le front n’y est pas encore connecté et aucune méthode de connexion n’est activée. Il n’y a pas d’enregistrement des conversations sur le serveur de l’app. Les 30 derniers passages et les trois derniers audios de réécoute restent en mémoire dans l’onglet. Les préférences et autorisations de voix sont conservées dans ce navigateur. Les voix clonées sont hébergées chez ElevenLabs jusqu’à leur suppression ; les fournisseurs appliquent leurs propres règles de conservation aux requêtes.

## Socle comptes et préférences

Le [guide backend](docs/backend.md) décrit le routage, les contrôles, les procédures disponibles, les migrations et le branchement du futur frontend.

```sh
# Renseigner DATABASE_URL, BETTER_AUTH_URL et BETTER_AUTH_SECRET dans apps/server/.env.local.
pnpm dev:server
```

La commande attend PostgreSQL, applique les migrations, puis lance l’API avec rechargement et Studio. La configuration d’exemple utilise PostgreSQL sur `localhost:5436`. Les identifiants du compose local sont réservés au développement. Le serveur seul reste accessible via `pnpm --filter @interprete/server dev` pour les usages avancés.

Studio est déjà lancé par `pnpm dev:server` : ouvrir https://local.drizzle.studio. La commande autonome `pnpm db:studio` reste disponible si l’on souhaite lancer uniquement Studio contre une base déjà démarrée. Les commandes de base utilisent `DATABASE_URL` depuis `apps/server/.env.local`.

Après une modification de `src/db/schema.ts`, exécuter `pnpm --filter @interprete/server db:generate`, relire et committer les fichiers `apps/server/drizzle/`, puis lancer `db:migrate`.

En production, fournir une URL PostgreSQL accessible depuis le conteneur, une URL publique HTTPS dans `BETTER_AUTH_URL` et un secret distinct de `SESSION_SECRET`. Construire l’image, appliquer les migrations une seule fois, puis démarrer l’API :

```sh
API_DOMAIN=api.example.com docker compose build api
API_DOMAIN=api.example.com docker compose run --rm api node dist/db/migrate.mjs
API_DOMAIN=api.example.com docker compose up -d
```

Le stockage des jetons dans Tauri et les méthodes de connexion restent à intégrer avec le frontend. Ne pas utiliser le jeton anonyme `interprete-session` pour les comptes.

## Variables serveur

| Variable | Usage |
| --- | --- |
| `INTERPRETER_OPENAI_API_KEY` | Transcription et traduction OpenAI |
| `ELEVENLABS_API_KEY` | Synthèse, inventaire, création et suppression des voix |
| `AI_GATEWAY_API_KEY` | Évaluation Jev ; la traduction finale fonctionne aussi sans ce service |
| `SESSION_SECRET` | Signature des sessions anonymes et autorisations de voix ; valeur aléatoire longue |
| `DATABASE_URL` | Connexion PostgreSQL pour les comptes et préférences |
| `BETTER_AUTH_URL` | URL publique de l’API, HTTPS en production |
| `BETTER_AUTH_SECRET` | Secret d’authentification distinct, au moins 32 caractères |
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

Les tests serveur couvrent aussi le routage oRPC et le refus des appels non authentifiés sans nécessiter de base. Le test d’intégration applique les migrations et crée/supprime ses propres utilisateurs ; il doit utiliser une base dédiée :

```sh
TEST_DATABASE_URL=postgresql://interprete:interprete@localhost:5436/interprete_test pnpm --filter @interprete/server test:db
```

Créer au préalable la base `interprete_test` dans le PostgreSQL local. Ce test utilise de vraies sessions Better Auth, sans activer de méthode de connexion ni appeler les fournisseurs IA.

Les tests couvrent les signatures, la séparation des voix, le consentement, les flux incomplets, la lecture avant l’arrêt de la capture, l’absence de répétition finale et le démarrage parallèle. `pnpm exec tsx scripts/verify-live-app.ts <synthetic-24khz.wav>` teste silencieusement les vraies API, sans haut-parleur. Les anciens scripts de benchmark restent dans `scripts/` ; ils utilisent les services payants et ne sont pas exécutés par les tests de l’app.

Voir [les vérifications effectuées](docs/VALIDATION.md). Les latences de démonstration sont des observations sur quelques phrases, pas un benchmark représentatif de toutes les langues et conditions réseau.

## Déploiement

- **Web (Vercel)** : [interprete-live.vercel.app](https://interprete-live.vercel.app) sert le build Vite de `apps/desktop` (`dist/`). La variable de build `VITE_API_URL=https://interprete-backend.vercel.app` relie les clients Hono et oRPC au backend commun. `apps/desktop/vercel.json` conserve le routage de l’app lors d’un rechargement.
- **API (Vercel)** : le projet `interprete-backend` utilise `apps/server`, la région Frankfurt et la base Neon `interprete-postgres`. `pnpm --filter @interprete/server build:vercel` génère `dist/app.mjs` ; `apps/server/app.mjs` l’expose au runtime Hono sans ouvrir de serveur autonome. Les clés fournisseurs et les secrets de session restent exclusivement dans les variables serveur. `BETTER_AUTH_URL` doit correspondre au domaine de l’API et `ALLOWED_ORIGINS` inclure les domaines web autorisés. Appliquer les migrations avec la connexion Neon avant d’ouvrir le parcours comptes.
- **API (VPS)** : copier le repo et `apps/server/.env.local` sur le serveur, puis `API_DOMAIN=api.example.com docker compose up -d --build`. Caddy obtient le certificat HTTPS et relaie le SSE sans buffering ; l’image contient les bundles ESM `dist/server.mjs`, `dist/db/migrate.mjs` et les migrations SQL. Pour le socle comptes, configurer PostgreSQL et suivre les [étapes de déploiement](docs/backend.md#déployer). Une seule instance : les limites de requêtes sont en mémoire.
- **Desktop** : `pnpm build:desktop`. Sur macOS, `Info.plist` déclare l’usage du micro et `Entitlements.plist` l’autorise sous hardened runtime ; la signature et la notarisation se configurent à part.

La conversation vocale fonctionne dans le navigateur avec l’autorisation microphone. La détection des appels sur Mac, les fenêtres flottantes hors navigateur et le microphone virtuel nécessitent l’app Tauri. Les limites de requêtes restent en mémoire par instance ; le déploiement Vercel ne les transforme pas en quotas distribués.

Le clonage d’une voix réelle nécessite l’accord de cette personne et un échantillon propre. Les deux personnes prennent toujours la parole à tour de rôle ; seule la traduction synthétique chevauche la parole. L’identification automatique des personnes et la séparation de deux voix humaines simultanées ne sont pas prises en charge.

Références : [transcription continue OpenAI](https://developers.openai.com/api/docs/guides/realtime-transcription), [streaming ElevenLabs](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts).

## Agents de développement

[AGENTS.md](AGENTS.md) rassemble les règles du projet et les commandes de vérification ;
[CLAUDE.md](CLAUDE.md) charge ce même guide pour Claude Code.
Le [catalogue des skills](docs/agent-skills.md) couvre les commits et PR, les revues,
les builds, les dépendances, l’interface, Rust et les flux audio.
Le skill [ship-and-merge](.agents/skills/ship-and-merge/SKILL.md), partagé avec Codex et Claude Code,
se lance explicitement avec `$ship-and-merge` ou `/ship-and-merge` pour publier puis fusionner
la PR de la tâche après les vérifications. Le déploiement manuel reste une action distincte.
