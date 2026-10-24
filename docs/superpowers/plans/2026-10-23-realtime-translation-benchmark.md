# Realtime Translation Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a proposed plan, not an instruction to start execution or spawn agents now. Follow the current session's authorization when execution begins.

**Goal:** Comparer la latence audible, la fidélité et le coût de GPT Realtime Translate et de chaînes STT → traduction → TTS, puis déployer une app A/B utilisable par Kevin.

**Architecture:** Un runner rejoue les mêmes audios au rythme réel dans des adaptateurs interchangeables et journalise des événements normalisés. Une app Next.js/Tailwind compare deux bras et mesure également leur lecture navigateur. Les clés et traitements de modèle restent sur serveur ; les connexions média directes utilisent des jetons éphémères.

**Tech Stack:** TypeScript, Node.js, Next.js App Router, Tailwind CSS, WebRTC/WebSocket, Vercel, AI Gateway. Aucun serveur GPU à provisionner avant qu'une mesure justifie une inférence auto-hébergée.

**Spec:** [Protocole et recherche](../../translation-benchmark-spec.md).

## Global Constraints

- Kevin a demandé un plan et des propositions avant la suite de la réalisation. Ne pas poursuivre l'application ou son déploiement dans ce tour de planification.
- Ne pas utiliser le brainstorming : Kevin l'a explicitement décliné.
- Conserver `typesafe-ai/jev-1.14.0` pour l'expérience Jev.
- Accès Cartesia à connecter ; aucun abonnement payant à souscrire implicitement.
- Aucun secret en source, résultat, capture, log, URL de partage ou export.
- Ne pas transformer les latences commerciales en mesures de bout en bout.
- Signaler les modèles indisponibles, bras incomplets et erreurs ; ne pas remplacer un modèle silencieusement.
- Pas de génération audio locale ; capture, transport, rééchantillonnage nécessaire et lecture seulement dans le navigateur.
- Toute comparaison de modèles conserve les autres variables fixes et indique le trajet direct ou AI Gateway.

---

## État de départ

Le dossier `/Users/kevin/Documents/coding_local/instant-translate` contient un squelette de dépendances, `.gitignore`, `PRODUCT.md` et un fichier d'environnement privé. Aucune interface ni route métier n'est implémentée. Aucun benchmark audio comparatif ni déploiement n'a été effectué. Le test Jev et les vérifications d'accès sont consignés dans la spec.

## Arborescence cible

```text
src/bench/contracts.ts               Types communs, configuration, événements
src/bench/clock.ts                   Horloge monotone et ordonnanceur de trames
src/bench/corpus.ts                  Métadonnées, annotations, couples de langues
src/bench/metrics.ts                 Mesures par essai et agrégations
src/bench/runner.ts                  Exécution, annulation, ordre aléatoire
src/bench/adapters/stt/              Gladia, ElevenLabs, Speechmatics, OpenAI, Deepgram, Cartesia
src/bench/adapters/translation/      AI Gateway, OpenAI Predicted Outputs
src/bench/adapters/tts/              ElevenLabs, Cartesia, OpenAI Realtime
src/bench/adapters/native/           OpenAI Realtime Translate
src/bench/commit-policy.ts           Validation locale, Jev et petit modèle OpenAI
src/app/api/session/route.ts         Création de sessions / jetons autorisés
src/app/api/interpret/route.ts       Traduction et audio streamés côté serveur
src/app/api/evaluate/route.ts        Décisions Jev/OpenAI sur fragments
src/app/lab/page.tsx                 Interface A/B
src/components/translation-lab.tsx   Capture, contrôles et rendu du laboratoire
src/lib/pcm-player.ts                File PCM, annulation, mesure de lecture
public/pcm-capture-worklet.js        Capture PCM sans modèle local
scripts/benchmark.ts                 CLI du pilote puis de la confirmation
tests/bench/*.test.ts                Tests de mesures, annulation et stabilité
tests/e2e/translation.spec.ts        Parcours navigateur avec source audio contrôlée
benchmark-results/                  JSON/CSV et manifeste des expériences
```

Un fichier par fournisseur, avec protocole et erreurs de ce fournisseur. Ne pas créer des fichiers vides pour les candidats écartés au pilote.

### Task 1: Corpus reproductible et mesures vérifiables

**Files:** `src/bench/contracts.ts`, `clock.ts`, `corpus.ts`, `metrics.ts`, `runner.ts`, `tests/bench/metrics.test.ts`, `tests/bench/clock.test.ts`, `scripts/benchmark.ts`.

**Interfaces:**

```ts
type Stage = "stt" | "translation" | "decision" | "tts" | "native";
type EventKind = "ready" | "source-partial" | "source-final" |
  "translation-partial" | "translation-committed" | "audio-received" |
  "audio-non-silent" | "playback-start" | "playback-end" | "error" | "closed";

interface AudioFrame {
  sequence: number;
  audioStartMs: number;
  sampleRate: number;
  pcm: Int16Array;
}
interface BenchEvent {
  runId: string;
  revision: number;
  stage: Stage;
  kind: EventKind;
  observedAtMs: number; // local monotonic clock
  audioPositionMs?: number;
  text?: string;
  code?: string; // sanitized failure code, never raw provider response
}
interface TrialResult {
  runId: string;
  status: "ok" | "failed" | "timeout" | "unavailable";
  firstAudibleMs: number | null;
  finalLagMs: number | null;
  transcript: string;
  translation: string;
  events: BenchEvent[];
}
interface BenchAdapter {
  id: string;
  run(input: AsyncIterable<AudioFrame>, signal: AbortSignal): AsyncIterable<BenchEvent>;
}
```

- [ ] Préparer 12 extraits de 5–15 s avec référence source, langue cible, début/fin de parole et points de sens annotés. Inclure négation, montant, nom propre, hésitation et phrase corrigée. Les fixtures synthétiques sont identifiées comme telles ; ajouter des voix humaines avant de conclure.
- [ ] Écrire les tests ci-dessous avant l'agrégateur, puis constater leur échec avant implémentation.

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { firstAudibleDelay, failedTrialRate } from "../../src/bench/metrics";

test("ne confond pas réception audio et lecture", () => {
  const points = { sourceSpeechStartMs: 100, audioReceivedMs: 300, playbackStartMs: 390 };
  assert.equal(firstAudibleDelay(points), 290);
});
test("inclut les essais en échec dans le taux", () => {
  assert.equal(failedTrialRate(["ok", "timeout", "failed", "ok"]), 0.5);
});
```

- [ ] Implémenter `firstAudibleDelay(points): number | null`, `failedTrialRate(statuses): number` et les journaux d'essai. Retourner `null` en absence de lecture plutôt que zéro. Refuser les timestamps non monotones et distinguer les repères de l'audio des heures de réception.
- [ ] Ajouter l'ordonnanceur à horloge injectable et vérifier qu'un extrait de 10 s n'est pas envoyé d'un bloc. Conserver les silences et compter les trames envoyées, perdues et reçues tardivement.
- [ ] Exporter JSON/CSV avec IDs exacts, paramètres, langue, région, trajet réseau, condition froide/chaude et statut. Ajouter un test de caviardage des secrets et URL signées.
- [ ] Vérifier `npx tsx --test tests/bench/*.test.ts` ; la métrique de lecture reste indisponible tant que la mesure navigateur n'existe pas.

**Livrable vérifiable :** le même corpus est rejoué au rythme réel et les calculs distinguent correctement réception, silence, lecture et échec.

### Task 2: Adaptateurs et pilote des composants

**Files:** `src/bench/adapters/stt/*`, `translation/*`, `tts/*`, `native/*`, `scripts/benchmark.ts`, `tests/bench/provider-events.test.ts`.

**Consumes:** `AudioFrame`, `BenchEvent`, `BenchAdapter`, `TrialResult` de Task 1.

**Produces:** Adaptateurs nommés par fournisseur, enregistrés dans `src/bench/adapters/registry.ts`; `runTrial(adapter, corpusCase, config, signal): Promise<TrialResult>`.

- [ ] Connecter Cartesia via son tableau de bord, avec intervention de Kevin pour l'authentification si nécessaire. Écrire la clé uniquement dans le fichier d'environnement ignoré et dans l'environnement serveur du projet. Ne jamais la demander en clair dans le chat. Valider une connexion et un seul extrait avant le pilote.
- [ ] Implémenter d'abord OpenAI Realtime Translate, Gladia et ElevenLabs pour produire une référence fonctionnelle. Brancher ensuite Speechmatics, OpenAI Live Transcribe, Deepgram et Cartesia Ink 2 selon la spec et leurs langues réellement disponibles.
- [ ] Normaliser les révisions sans dupliquer les énoncés. Gladia : même `data.id` remplacé par le partiel suivant puis le final. ElevenLabs : partiels remplacés dans le segment courant puis commit. Tester ces deux séquences avec des événements enregistrés sans secrets.
- [ ] Pour OpenAI Live Transcribe, lire le schéma actuel et tester `minimal` puis `low`. Ne pas réutiliser les paramètres VAD des autres sessions : ce modèle ne prend pas `server_vad` ni `semantic_vad`.
- [ ] Implémenter les traductions AI Gateway avec `openai/gpt-4.1-nano`, `openai/gpt-5.4-nano` sans raisonnement et `google/gemini-3.5-flash-lite` au réglage minimal supporté. Vérifier les IDs dans le catalogue au moment de l'essai ; journaliser tout échec d'accès.
- [ ] Voix : Eleven Flash, snapshot Cartesia Sonic 3.6 et OpenAI Realtime mini avec lecture fidèle du texte. Comparer les mêmes textes, la même langue et des formats PCM compatibles. Mesurer premier octet et premier PCM non silencieux distinctement.
- [ ] Exécuter 12 extraits × 3 répétitions par candidat, ordre aléatoire. Une connexion froide, deux chaudes. Ne pas lancer des flux concurrents si les quotas les rendent inéquitables.
- [ ] Présélectionner les composants par fidélité, latence stable et coût, avec tous les échecs visibles. Le résultat de ce task est une présélection, pas le classement final de l'app.

**Livrable vérifiable :** résultats de composants reproductibles et bras complets A/B/C prêts à comparer ; accès indisponibles signalés explicitement.

### Task 3: Validation de fragments, Jev et prédiction OpenAI

**Files:** `src/bench/commit-policy.ts`, `src/bench/adapters/translation/openai-prediction.ts`, `tests/bench/commit-policy.test.ts`.

**Consumes:** révisions source et traductions de Task 2.

**Produces:**

```ts
type CommitDecision = { revision: number; action: "wait" | "commit"; score: number | null };
interface PendingTranslation {
  revision: number;
  sourceText: string;
  translatedText: string;
  spokenPrefix: string;
}
interface CommitPolicy {
  decide(input: PendingTranslation, signal: AbortSignal): Promise<CommitDecision>;
}
```

- [ ] Implémenter le contrôle local sans appel réseau : stabilité du préfixe sur des révisions successives, borne temporelle explicite et validation aux frontières de clauses. Les seuils sont des paramètres d'expérience, pas des constantes prétendument universelles.
- [ ] Comparer Jev et les petits modèles OpenAI sur les mêmes décisions `wait/commit` et mêmes candidats. Jev passe par `/v1/evaluate`; un modèle génératif ne reçoit pas le même schéma par supposition.
- [ ] Tester les événements arrivant en retard : une décision sur la révision 2 ne peut jamais valider la révision 3. Annuler la génération dépassée et sa lecture ; enregistrer son coût même si elle n'est pas entendue.
- [ ] Tester « Je veux réserver » puis « Je ne veux pas réserver » et une correction de montant. Aucun tampon non validé ne doit être joué après invalidation. Si un mot était déjà prononcé, compter l'erreur plutôt que la masquer.
- [ ] Ajouter Predicted Outputs au même `gpt-4.1-nano`, avec `prediction.content` égal à la traduction provisoire antérieure. Vérifier les compteurs de jetons acceptés/rejetés. Si AI Gateway supprime ou refuse le paramètre, comparer via OpenAI direct avec son contrôle direct, sans mélanger le gain de routage et le gain de prédiction.
- [ ] Comparer le temps gagné à l'ensemble du coût ajouté, y compris évaluateur et audio préparé puis abandonné. Écarter les variantes qui ralentissent la chaîne ou augmentent les erreurs prononcées.

**Livrable vérifiable :** réponse mesurée à la question « Jev ou la prédiction OpenAI réduit-il réellement la latence utile ? » avec contrôle sans évaluateur.

### Task 4: App A/B avec mesure de lecture réelle

**Files:** routes API, `src/app/lab/page.tsx`, `src/components/translation-lab.tsx`, `src/lib/pcm-player.ts`, `public/pcm-capture-worklet.js`, `tests/e2e/translation.spec.ts`.

**Consumes:** mêmes paramètres et adaptateurs que le runner. Les essais de laboratoire et la production ne doivent pas avoir deux moteurs divergents.

**Produces:** interface A/B utilisable au microphone, événements `playback-start/end` et exports corrélés aux essais.

- [ ] Construire les contrôles source/cible, choix des bras, source audio, démarrage/arrêt, texte et audio. Écouter un seul bras à la fois pour éviter les mélanges. Afficher les conditions masquées lors de l'écoute puis révéler les moteurs après le vote.
- [ ] Créer les sessions côté serveur et garder les clés permanentes privées. Autoriser les seules langues et modèles prévus, limiter la durée des sessions et protéger l'accès à l'app expérimentale avant toute exposition avec facturation.
- [ ] Jouer le PCM en continu avec un tampon de gigue mesuré. Ne pas attendre un fichier complet et ne pas jouer plusieurs AudioContext concurrents par fragment. L'arrêt doit fermer micro, sockets et sources programmées.
- [ ] Distinguer première réception, première trame non silencieuse, instant programmé de lecture et estimation de sortie du périphérique. Indiquer la précision réelle de la mesure ; ne pas annoncer une mesure acoustique sans capture de boucle audio.
- [ ] Vérifier dans le navigateur un extrait contrôlé, le refus du micro, l'arrêt pendant une génération, une erreur fournisseur, un fragment long et une reconnexion. Vérifier desktop et mobile sans modifier le protocole pour embellir le résultat.
- [ ] Exécuter typecheck, tests des métriques, tests de stabilité, test audio navigateur et build. Relire le diff réel avant de diffuser l'URL.

**Livrable vérifiable :** Kevin peut écouter A et B, lire les mêmes transcriptions et comparer des délais qui incluent la file de lecture.

### Task 5: Confirmation des finalistes et Vercel

**Files:** `benchmark-results/*`, `docs/benchmark-results.md`, configuration Vercel du nouveau projet uniquement.

- [ ] Étendre le corpus à 50 énoncés par paire, trois répétitions par finaliste, plus un passage continu de 60 s. Conserver les voix humaines et une écoute bilingue ; publier les exclusions de langues.
- [ ] Comparer A, B et C puis le deuxième STT et les variantes spéculatives compétitives. Rapporter p50/p95 avec nombre d'essais, erreurs, intervalles d'incertitude et coûts. Une amélioration de quelques millisecondes doit être reproductible et supérieure à la variabilité de mesure.
- [ ] Décider sur le compromis retard/fidélité, avec attention aux nombres et négations. Si le plus rapide prononce davantage d'erreurs, montrer les deux profils au lieu d'annoncer un vainqueur unique.
- [ ] Créer un projet Vercel distinct dans l'équipe VoiceCheap découverte, vérifier le projet, l'environnement et la révision exacte. Régler la protection de l'app et les secrets privés. Ne pas modifier les déploiements VoiceCheap existants.
- [ ] Valider l'aller-retour depuis le déploiement, comparer la région et le trajet média à la passe locale. Si un worker WebSocket est nécessaire, le déployer séparément puis revérifier le même parcours.
- [ ] Livrer l'URL utilisable, le classement sourcé, les essais rejouables et la liste précise des limites. Distinguer ce qui est déployé, testé en audio et seulement implémenté.

**Livrable vérifiable :** une app hébergée dont le moteur par défaut est choisi par des mesures, avec un mode A/B conservé pour les prochains modèles.
