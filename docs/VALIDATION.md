# Vérifications de l’app — 24 octobre 2026

## Verb, compound and agreement trial — 25 October 2026

The next user-authorized trial refines the current Jev instructions to hold ambiguous
verbs until their complement is known and to keep multiword names/noun compounds
together. Translation instructions now explicitly continue target-language gender,
number and verb construction, and use established translations of complete names.
Models, the 0.6 readiness threshold and local segmentation rules are unchanged.

Final gate calibration: 19 cases repeated twice, no unavailable responses. The
requested stable subject still passes (0.61–0.68); incomplete verb/name/compound
examples now wait, while their complete forms pass. An unseen verb-complement
boundary still passes despite its conservative expected-wait label (36/38 labels
matched); this prompt is not a deterministic boundary validator. Sixteen translation
outputs (eight cases twice) preserved the tested agreements, names, repetition,
negation and amount. These are small manual calibration checks, not a quality score.

One silent NASA EN→FR run with real providers and in-process Hono routes completed:
first transcript 1.88 s, first captions 4.94 s, 37 held out of 49 attempts, 12 completed
fragments, no errors/unavailability, maximum caption gap 4.53 s. Manual review found
the previously observed verb, station-name, environment and plural-agreement errors
corrected in the resulting text. A literal intensifier translation and wrong relative
pronoun remained in the later microgravity clause. The station name was still split
in the source requests, although its translated output was correct: the grouping
instruction is not always obeyed.

The user's preceding browser/native scan started captions at 2.35 s with 13 holds
out of 33 attempts. The slower new observation is a warning about the quality/latency
tradeoff, not a controlled A/B comparison: capture adapter and transport differ and
only one new run was made. No TTS, microphone, speaker output or acoustic timing.
Workspace typecheck, server lint, 13 configuration/29 server/114 desktop tests and
server/desktop/landing builds pass. The final prompt-only adjustment was bundled
again and the diff checked. Private traces remain outside the repository.

## Stable subject-prefix prompt trial — 25 October 2026

At the user's request, the current Jev prompt now explicitly accepts stable subject
prefixes, including an open “when” clause, without requiring its verb. It distinguishes
these from adjectives awaiting nouns and unfinished compounds. Only the prompt was
changed for this trial: the 0.6 threshold, provider model, local guards and request
data are unchanged. This supersedes the original-question configuration retained
at the end of the previous investigation below.

Final text-only check: 11 cases, two repetitions before and after (44 evaluations,
zero unavailable responses). The requested English prefix scored 0.45–0.48 before
and 0.91 after, with known following words supplied. Two unseen English/French
subject prefixes also crossed the threshold. All 10 expected-ready evaluations and
12 expected-wait evaluations matched their labels after the change, including
negations, numbers and a compound not included in the prompt. An earlier draft
incorrectly allowed an adjective/compound boundary; the final prompt corrected it.
These are small calibration checks, not replay of the user's exact recorded context
or proof of end-to-end translation quality.

Workspace typecheck, server lint, 13 configuration/29 server/111 desktop tests and
server/desktop/landing builds pass. The user will run the full benchmark next;
latency, complete translations and synthesized audio remain unverified for this
prompt. No microphone or audible playback was used during these checks.

## NASA scan diagnosis and fixes — 25 October 2026

The new user run was captions-only: 22.72 seconds of input, 43 held attempts out of
51 and first captions at 7.63 seconds. Gate scores were still absent: React refresh
could retain a controller created before diagnostics were added. Missing historical
fields must not be reported as zero provider failures.

Corrections retained:

- Completed sentences ending in words such as English “for” or “that” are no longer
  blocked as dangling prefixes. Commas, ellipses and unfinished prefixes still wait.
- Jev receives only the current translated continuation as its preceding source,
  rather than the last unrelated conversation turn. Its request shape is unchanged.
- Development engine edits cancel and release controllers before reloading. One
  initial reload is needed to replace instances predating this hook.
- Starting a benchmark selects the new run; inspecting history afterward remains
  possible without selection being reset on every update.
- Translation instructions preserve repetitions actually present in the new fragment,
  while forbidding retranslation of the old source prefix. A broad prohibition on
  repeating anything already translated could omit a reintroduced subject.

### Provider investigation and rejected optimizations

Six alternating, silent NASA English→French runs used real OpenAI/Jev calls, the
real controller and Hono routes in process, 20 ms PCM frames and no speech synthesis.
Models and readiness threshold (0.6) were unchanged. The three original-question
controls recorded 126 Jev refusals and one unavailable evaluation: semantic holds,
rather than provider failures, dominate this sample. First captions had a median
of 5.28 seconds, ranging from 4.80 to 11.98 seconds.

A more permissive question reduced that median to 2.11 seconds (1.85–2.19), but
manual inspection found major translation regressions in all three runs. A second,
more cautious question also failed quality review in one of two runs. Both question
changes were rejected; the original question and threshold remain. The first new
caption was sometimes just an introductory word, so these numbers also compare
different amounts of content. This is not a demonstrated shipping latency gain.

The separate translation-instruction correction was checked on eight text cases,
twice before and twice after (32 provider calls): repeated subjects/objects,
intentional repetitions, ordinary continuation, split negation and repeated amounts,
in both language directions. The observed subject omission occurred in one of two
original outputs and neither corrected output. All 16 corrected outputs passed
manual checks for those cases; this is a small, non-blinded check, not a general
translation-quality score. No provider response or transcript is stored in this doc.

Two additional NASA runs with the original question but extra language/translation
metadata also showed quality problems. Those metadata additions were removed too;
only the deterministic continuation selection fix remains in the gate input.

### Verification and limits

Workspace typecheck, server ESLint, 13 configuration tests, 29 server tests,
111 desktop tests, 17 benchmark-tool tests and server/desktop/landing builds pass.
Existing desktop chunk-size and landing module-directive warnings remain.
Controller regressions cover punctuation without ending capture; server regressions
cover continuation selection in both directions.

Synthetic browser checks at desktop and 390 px verify new-run selection, preserved
history/baseline choices during updates and stop, with no overflow or browser errors.
HMR cleanup was checked with simulated capture and two native players, including
waiting for pending native closes. Native-window reload was not verified: preview
snapshots timed out twice and the native automation tool could not bind the debug
executable. No real microphone, speaker playback or native bundle was used.

The NASA timing investigation covers captions only, excludes the browser/backend
network hop, and is not a word-aligned or acoustic benchmark. The main semantic
readiness delay remains; the rejected faster questions must not be reported as a fix.

## Jev benchmark diagnostics — 25 October 2026

The benchmark now retains the existing gate probability and unavailable flag,
separates Jev wait decisions from evaluation failures, and identifies local decisions
and older runs with missing details. No server readiness rule or model changed.

- Workspace typecheck, server ESLint, 13 configuration tests, 28 server tests,
  110 desktop tests, 17 benchmark-tool tests, and server/desktop/landing builds pass.
- Controller tests cover accepted, held, unavailable and local gates without
  changing caption/audio delivery. Recorder tests check reload/export data,
  zero/one/null probabilities, legacy compatibility and malformed stored values.
- Browser checks at 1280×1000 and 390×844 verify scores/statuses, counts, fragment
  details, JSON export and reload. All input/results were synthetic; no real
  microphone, provider call or audible playback was used. No browser exceptions or
  page overflow were observed. Existing build warnings remain as documented below.

The user's first NASA run predates these fields. Its refusals cannot be diagnosed
retroactively; no new live-provider or native acoustic benchmark was run here.

## Benchmark workspace — 25 October 2026

Recording tests and call previews now live under Benchmark. Verified locally:

- Typecheck across the workspace, server ESLint, 13 configuration tests, 28 server
  tests, 105 desktop tests, and 17 benchmark-tool tests pass.
- Server bundle and desktop/landing static builds pass. Vite still reports the
  desktop chunk-size warning; landing bundling reports module-directive warnings.
- Browser checks at 1280×1000 and 390×844 cover captions-only and voiced reports,
  fragment inspection, manual notes, mismatched comparison, JSON export, stop and
  navigation cancellation, provider errors, outgoing FR→EN, and caption previews.
  Capture, ASR/provider responses and playback were mocked; no microphone or audible
  output was used. No page overflow or browser exceptions were observed.
- Recorder tests cover session isolation, missing native playback timestamps,
  cancellation, corrupt/full storage, bounded history/traces, comparison eligibility
  and exclusion of signed voice grants. A controller regression checks observer
  isolation and the capture/request/playback/end events using the existing harness.

These checks validate the diagnostic tool, not real provider latency. No paid live
benchmark, acoustic measurement, native capture or Tauri bundle was run for this
change. See [BENCHMARK.md](BENCHMARK.md) for the measurement protocol and limits.


## Latence de la traduction des interlocuteurs — 25 octobre

Mesures silencieuses avec les vrais fournisseurs (transcription `gpt-live-transcribe`, Jev, `gpt-5.4-nano`, ElevenLabs Flash v2.5), sans micro ni haut-parleur. Source : 6 passages anglais et 4 passages français synthétiques (voix ElevenLabs, horodatage exact de chaque mot), joués en temps réel en trames de 20 ms, une session par langue avec 2,5 s de pause entre les passages et la connexion déjà ouverte, comme pendant un appel. Une pause de 450 ms ferme l’item ASR comme la capture système ; la file de lecture est simulée. Le code d’origine (`277ea77`) et le nouveau code tournaient sur deux API locales, en alternance, 3 répétitions chacun : 30 passages, environ 90 segments et 450 mots par variante et par série. Ces mesures précèdent le passage de la traduction à `gpt-5.4-mini` (section suivante) : son premier token médian est environ 0,15 s plus lent, ce qui s’ajoute aux valeurs absolues ci-dessous pour les deux variantes.

Définitions : **début** = début de la parole → début de sa voix traduite ; **retard de segment** = fin du dernier mot d’un segment → début de sa voix traduite ; **décalage par mot** = fin de chaque mot → début de la voix de son segment ; **fin** = fin du passage → fin de sa voix traduite.

| Série finale, P50 (P90) | Code d’origine | Nouveau code |
| --- | --- | --- |
| Début | 3,17 s (4,61 s) | 2,87 s (4,09 s) |
| Retard de segment | 1,65 s (3,61 s) | 1,26 s (3,37 s) |
| Décalage par mot | 2,62 s (4,04 s) | 2,17 s (3,58 s) |
| Fin du dernier segment → sa voix | 2,53 s (5,05 s) | 2,03 s (4,14 s) |
| Fin | 4,20 s (6,32 s) | 3,38 s (5,56 s) |

Étapes P50 du nouveau code : mot reconnu par l’ASR 0,34 s après sa fin ; envoi du segment 0,26 s plus tard (0,58 s avant) ; premier texte traduit 0,40 s et premier audio 0,58 s après la requête. La file atteint encore ~1,9 s au P90 dans les passages anglais → français, plus longs à prononcer : l’accélération limitée à 1,2 la réduit sans l’annuler. Une première série avec chaque mot considéré complet après 80 ms donnait un décalage par mot de 1,94 s, mais des coupures moins fluides (voir ci-dessous) ; elle n’a pas été retenue.

Qualité, notée par `gpt-6.1-sol` :

- Découpage rejoué mot à mot sur les 10 passages, avec le vrai Jev et le prompt de traduction : abaisser le seuil de Jev de 0,6 à 0,45, 0,3 ou le supprimer réduit l’attente moyenne de 1,8 à 1,1 puis 0,6 mot, mais la fidélité chute de 3,9 à 2,9–3,1/5 (« running » traduit par « courir », montants coupés). Le seuil reste 0,6. Avec un mot d’anticipation, la fluidité est de 3,8–4,1/5 contre 3,1–3,3/5 sans (deux essais chacun) : le dernier mot attend donc le suivant, sauf après 250 ms de pause.
- Fragments isolés (34 cas de continuation) : avec `gpt-5.4-nano`, le nouveau prompt obtient 59/68 contre 42/68 pour l’ancien, qui traduisait les mots d’anticipation ; avec `gpt-5.4-mini`, 61 et 65/68 contre 56/68 à chacun des deux essais, l’ancien prompt traduisant encore ces mots (« Nous ne voulons pas » → « to cancel »).
- Traductions complètes des sessions mesurées : le nouveau code est au moins au niveau du code d’origine dans les deux séries (6 sessions par variante ; notation bruitée). Les erreurs restantes viennent surtout de coupures entre deux fragments traduits par un petit modèle.
- Silences retirés autour des fragments ElevenLabs : crête ≤ −60 dBFS en fin de fragment ; un seul début retiré dépassait ce niveau (souffle de 48 ms, −51 dBFS RMS).

Plancher de cette architecture : environ 0,34 s d’ASR, 0,40 s avant le premier mot traduit et 0,18 s de synthèse, soit ~0,9 s après la fin d’un mot avant tout découpage ou file d’attente. Passer sous une seconde de retard de segment demanderait de renoncer au mot d’anticipation ou au feu vert de Jev, ce que les essais de qualité déconseillent. Les voix sont synthétiques, la latence acoustique d’un vrai appel n’a pas été mesurée et l’outil de mesure n’est pas versionné. La latence des fournisseurs a varié entre les séries ; seules les variantes mesurées en alternance sont comparées.

La série finale précède les corrections issues de la revue croisée : retrait d’un fragment non prononcé quand l’ASR révise ses mots ou que la suite annonce une négation, un montant ou un mot composé ; pauses déjà écoulées retirées ; `queued` envoyé par l’app au lieu de `pace`, avec la même courbe d’accélération. Ces corrections sont couvertes par des tests unitaires, et une session réelle de contrôle s’est terminée sans erreur, mais elles n’ont pas été remesurées en A/B : la machine de mesure gelait alors tous ses processus pendant 10 s à près de 2 min (mesuré sur une simple boucle de minuteurs Node), ce qui fausse toute mesure de latence. Les deux séries retenues ne montrent pas ce gel : aucun mot n’y a été reconnu plus de 1,8 s après sa fin.

## Sous-titres traduits sur votre vidéo — 25 octobre

La traduction de ce que vous dites peut être incrustée dans votre caméra et envoyée à OBS Virtual Camera, seule (texte uniquement, `speak: false`) ou avec la voix traduite. Voir [le guide](CALL-MODE.md#sous-titres-sur-votre-vidéo).

- Faisabilité : sur ce Mac (macOS 26.6.2, SIP actif, équipe Apple gratuite uniquement), une caméra système au nom d’Interprète n’est pas installable. Le code source de l’extension OBS confirme qu’elle accepte les images de tout client (autorisation inconditionnelle), avec une file de capacité 1 vidée en continu tant que son entrée tourne, et une image d’attente sans émetteur.
- Tests Rust : 39 réussis, 4 tests matériels ignorés. Un test natif fait tourner toute la chaîne (mire synthétique à 30 i/s, composition Core Image 1920 × 1080, sous-titre Core Text, aperçu JPEG) sans caméra et sans jamais envoyer d’image à OBS. Les tests couvrent aussi la validation des sessions, des caméras et des sous-titres, la liste des caméras sans ouverture, l’impossibilité pour une session remplacée d’arrêter le relais ou d’y écrire, le refus d’un démarrage demandé par une page précédente et la conservation de la caméra lancée par la nouvelle page.
- Tests desktop : 89 réussis. Ils couvrent le texte roulant (passages anciens retirés en entier, coupe stable d’un passage très long, limites UTF-16 et UTF-8, jamais au milieu d’un caractère), l’effacement après 5 s, l’absence de passages d’une session précédente, l’ordre démarrage/arrêt (arrêt pendant l’ouverture, démarrage remplacé puis arrêté), l’annulation pendant la demande d’autorisation, l’adoption de l’appel par un aperçu déjà lancé, les erreurs caméra et l’option mémorisée.
- Rendu du sous-titre vérifié sur images synthétiques : latin, arabe de droite à gauche, japonais.
- Interface vérifiée dans Chrome headless : mode navigateur, puis pont natif simulé (liste des caméras, OBS absent ou prêt, aperçu, état « Video on », sous-titres d’exemple et effacement, démarrage en sous-titres seuls). Avec ce pont simulé, un appel terminé pendant la demande d’autorisation n’ouvre pas la caméra ; s’il continue, elle s’ouvre une fois. Le toast, qui s’ajuste à son contenu, a été contrôlé avec ses quatre cases (400 × 394 px). Le navigateur intégré a de nouveau expiré.
- TypeScript, lint serveur, 13 tests de configuration, 20 tests serveur, bundle serveur, builds Vite desktop et landing, Clippy (`--all-targets -D warnings`) et bundle macOS debug réussis. Le bundle contient la description d’accès caméra.
- Revue indépendante (Codex gpt-6.1-sol, raisonnement maximal) : six défauts confirmés puis corrigés. Une autorisation caméra en attente pouvait ouvrir la caméra après la sortie du mode appel. Le rappel CoreMediaIO pouvait survivre à son contexte. Un aperçu lancé avant l’appel ne suivait pas cet appel. La vérification du propriétaire d’un sous-titre n’était pas atomique. Une caméra virtuelle bloquée laissait la caméra allumée. Le test ordinaire pouvait envoyer sa mire à OBS. Un second passage a confirmé ces corrections et relevé deux cas, corrigés aussi : un aperçu en attente d’autorisation pouvait démarrer après la fin de l’appel suivi, et décocher l’option laissait les sous-titres sur une vidéo déjà lancée. Un troisième passage a relevé qu’un aperçu déjà lancé pouvait adopter un appel terminé pendant la préparation du micro, et un quatrième qu’un rechargement de la fenêtre principale laissait la caméra allumée sans contrôle. Un dernier passage, après rebase, a relevé qu’un démarrage envoyé juste avant ce rechargement pouvait encore aboutir : chaque démarrage porte désormais le numéro de sa page, lu par une commande synchrone exécutée dans l’ordre des chargements. Tous ces cas sont corrigés et testés.
- Non vérifié : `pnpm test:virtual-camera` (l’extension d’OBS n’est pas encore activée sur ce Mac), capture d’une vraie caméra (aucune caméra n’a été ouverte), réception dans Meet, Zoom ou Teams, et l’état CoreMediaIO d’OBS Virtual Camera quand seul Interprète l’alimente. La détection ignore donc prudemment les deux caméras du relais.

## Overlays en plein écran, voix française native et son original coupé — 24 octobre

Les sous-titres et la pastille deviennent, comme le toast, des panneaux macOS non activants pour s’afficher par-dessus une app en plein écran. La voix traduite des interlocuteurs coupe le son original de l’appel. Les voix prédéfinies anglaises sont remplacées par des voix françaises natives pour une traduction en français. La traduction passe de `gpt-5.4-nano` à `gpt-5.4-mini`.

- Plein écran : un exécutable de test lancé comme app normale a reproduit le défaut. Sa fenêtre flottante classique n’était pas à l’écran sur l’espace plein écran d’une autre app, même avec `canJoinAllApplications` ou au niveau des fenêtres d’état. Convertie en panneau non activant (y compris par changement de classe d’une `NSWindow` existante, affichée avant ou après le passage en plein écran), elle était à l’écran, devant la fenêtre plein écran dans l’ordre du serveur de fenêtres. Dans la vraie app de debug, les trois fenêtres sont bien converties (`InterpreteOverlayPanel`, `InterpreteCallPromptPanel`). Le test plein écran sur la vraie app n’a pas pu être refait : l’écran s’est verrouillé pendant la session.
- Le changement de classe sans restauration faisait planter la libération de la fenêtre (exception KVO `_windowLayerContext`), y compris avec le toast de la version précédente, dans un test isolé. La classe d’origine est maintenant restaurée à la fermeture : libération sans erreur dans le test isolé, et arrêt de la vraie app (SIGINT) sans exception.
- Affichage d’un panneau : aucun vol du focus clavier (app non activée), `_preventsActivation` actif après conversion.
- Traduction : sur des fragments réels de la chaîne (préfixe déjà prononcé et texte d’anticipation), `gpt-5.4-nano` omettait souvent « would you prefer » et traduisait le texte d’anticipation, d’où des répétitions au segment suivant. `gpt-5.4-mini` était correct sur les 16 essais, pour un premier token médian de 631 ms contre 484 ms (p90 928 ms contre 538 ms). `gpt-6-luna` était correct mais trop lent (médiane environ 5,9 s). Ce sont 16 essais par modèle, pas un benchmark représentatif.
- Chaîne complète silencieuse (`scripts/verify-live-app.ts`, serveur local, vrais fournisseurs) : l’exemple anglais vers le français est traduit correctement 3 fois sur 3 avec la voix française native, audio reçu avant la fin de l’entrée (premier signal planifié vers 2,1 à 2,3 s, contre 1,7 à 1,9 s avant le changement, sur 3 essais seulement). L’exemple français vers l’anglais est correct 2 fois sur 2.
- Voix : les 9 voix françaises candidates de la Voice Library ont produit du PCM via `eleven_flash_v2_5` avec `language_code: fr`. Leur hauteur a été mesurée avec `VoiceProfiler` sur l’extrait public et sur l’échantillon généré. Une voix aux mesures incohérentes a été écartée. Utiliser une voix de la Voice Library par l’API l’ajoute au compte ElevenLabs. L’accent n’a pas été écouté : l’audio n’a pas été joué.
- Son coupé : le tap est créé sans erreur avec `CATapMutedWhenTapped`. `pnpm test:system-audio` livrait 0 trame avec ou sans coupure, l’écran étant verrouillé (autorisation de capture non accordable). La livraison des trames et le silence effectif sur les haut-parleurs restent à vérifier sur un vrai appel.
- Après rebase sur les sous-titres déplaçables : `pnpm typecheck`, `pnpm lint`, `pnpm test`, les builds serveur, desktop et landing, `cargo test` (31 réussis, 3 matériels ignorés) et `cargo clippy -D warnings` réussissent. Le panneau garde les clics et le déplacement natif (`performWindowDragWithEvent`) ; le geste réel de glisser-déposer n’a pas été revérifié sur le panneau.

## Finition des réglages de sous-titres — 24 octobre

- **Show captions / Hide captions** est intégré à la ligne **Preview** de la section **Placement**, avec les contrôles existants des réglages. Les paragraphes d’introduction et d’aide autour du bouton, ainsi que les indications de contraste/transparence, ont été retirés.
- Typecheck et build Vite réussis. Le vrai composant React, avec IPC Tauri simulée, a été revérifié à 820 et 390 px : affichage/masquage, changement de taille/thème, fermeture à la sortie de l’onglet, absence des textes supprimés et absence de débordement. Pas de nouveau contrôle natif pour cette finition visuelle.

## Déplacement natif et aperçu sur le bureau — 24 octobre

- Retrait de la miniature de placement intégrée aux réglages. **Show captions on my screen** affiche le texte fictif dans la même fenêtre Tauri que les appels ; **Hide desktop preview** et la sortie de l’onglet la ferment. Les réglages d’apparence et de taille restent appliqués en direct. Les sections historiques ci-dessous décrivent l’ancien aperçu intégré.
- Les sous-titres visibles acceptent le déplacement natif Tauri. La position normalisée et le nom du moniteur sont enregistrés localement ; les requêtes obsolètes et les arrondis de pixels ne doivent pas écraser un choix plus récent ni produire une boucle de repositionnement. Les sous-titres effacés laissent passer les clics.
- Vérification silencieuse des vrais composants React avec IPC Tauri simulée : à 820 et 390 px, ouverture/fermeture par l’unique publisher natif, absence de miniature, changement de taille/thème, fermeture à la sortie de l’onglet et absence de débordement. Le composant de fenêtre a aussi été testé à 1024 et 390 px : demande de déplacement natif, sauvegarde après événement de mouvement, thème en direct, requête ancienne ignorée et réponse de fenêtre masquée ignorée. Aucun son, micro ni fournisseur.
- Six tests Rust de sous-titres passent, dont la conversion aller-retour d’un déplacement sans dérive sur écrans Retina et à origine négative. Les tests de préférences couvrent aussi la validation et la persistance du moniteur. Typecheck, lint serveur, 13 tests de scripts, 18 tests serveur, 66 tests desktop, builds serveur/Vite, bundle macOS debug et Clippy passent. `cargo fmt --check` global retrouve les différences historiques de `audio_route.rs` et `system_microphone.rs`, laissées intactes.
- Le bundle macOS a été lancé sans modifier l’authentification ni l’onboarding : les commandes natives d’aperçu ont confirmé une fenêtre visible et dimensionnée, puis masquée. Les préférences antérieures ont été restaurées et l’instance de diagnostic fermée. Ce contrôle ne valide pas le geste physique de glisser-déposer ni le passage entre écrans/Spaces ; les interactions et la persistance de déplacement ont été vérifiées avec IPC simulée.

## Deuxième extrait, trois voix — 24 octobre

- Ajout de `nasa-three-speakers-en.wav` : échange NASA anglais continu de 24 s (00:24–00:48 du téléchargement officiel), avec Suni Williams, Houston et Bill Nelson. Source YouTube, téléchargement et reproduction dans [samples/README.md](../apps/desktop/public/samples/README.md). Sélection **Three voices · 24 seconds** sous **Choose a recording**, pour l’entrée anglaise uniquement, sans ajouter de bouton de lancement.
- Le scénario conserve le flux entrant commun, les sous-titres et les options son original/voix traduite. Il n’ajoute ni diarisation ni voix de synthèse par personne. La capture micro, la capture système et le clonage restent exclus des exemples.
- Deux régressions supplémentaires couvrent le choix du fichier, le retour au scénario par défaut, le maintien de l’exemple français et le format/durée du nouveau WAV. Typecheck, lint serveur, 13 tests de scripts, 18 tests serveur, 66 tests desktop, builds serveur/Vite réussis.
- Vérification silencieuse du vrai composant React isolé à 820 et 390 px : sélection du scénario à trois voix, description mise à jour, transmission du choix au démarrage intercepté, sous-titres activés et aucune capture ni requête fournisseur. Pas de débordement horizontal. Les fournisseurs et la lecture sont simulés ; aucune écoute acoustique ni vérification native Tauri n’a été effectuée pour cet ajout.

## Clarification des tests et retrait du repère — 24 octobre

- **Test without joining a call** présente un seul test principal avec explication de l’extrait, de la langue de traduction, de la fenêtre de sortie et de l’absence de capture micro. Deux options expliquées séparent son original et voix traduite. Les quatre outils secondaires sont repliés dans **Other checks**, chacun accompagné d’une description de son effet.
- Le carré autour du dernier mot a été retiré des sous-titres flottants ; le prompteur de l’onboarding reste inchangé. La section historique « Écoute de l’extrait et repère de lecture » ci-dessous décrit la version précédente.
- Vérification silencieuse du vrai composant React isolé à 820 et 390 px : un seul bouton principal, outils repliés au départ, descriptions présentes, absence de débordement, aperçu local sans repère et sans appel réseau ni micro. Le démarrage du test a été intercepté : exemple activé, sous-titres forcés et voix désactivée selon le choix affiché. Aucun fournisseur ni audio réel n’a été utilisé.
- Typecheck, 64 tests desktop, build Vite et `git diff --check` réussis. Le rendu natif macOS n’a pas été revérifié pour cette itération ; les contrôles de latence sont hors périmètre et confiés à un autre agent.

## Extrait YouTube pour la traduction entrante — 24 octobre

- Ajout d’un extrait NASA anglais de 22,723 s, mono PCM 24 kHz, sélectionné uniquement pour le test d’appel entrant anglais. Source et reproduction dans [samples/README.md](../apps/desktop/public/samples/README.md).
- Vérification silencieuse dans une instance Tauri de développement : bouton **Caption NASA audio · 23 s**, sous-titres cochés et voix traduite décochée. Les vrais fournisseurs ont produit une traduction française diffusée progressivement par les événements natifs `call-captions-state` (`en` → `fr`), puis le contrôle est revenu à l’état prêt. Ni micro, ni sortie sonore, ni clonage. L’observation des événements ne constitue pas une validation visuelle de la fenêtre au-dessus d’un appel en plein écran.
- Les deux nouvelles régressions vérifient la sélection du fichier, l’exclusion du clonage et de la capture système, ainsi que le format et la durée du WAV. Typecheck, lint serveur, 13 tests de scripts, 18 tests serveur, 59 tests desktop, build serveur et build Vite réussis. L’exécutable Tauri de développement a également compilé et démarré.
- La capture système réelle, l’audio traduit et le comportement sur plusieurs écrans/Spaces restent non vérifiés pour ce changement.

## Écoute de l’extrait et repère de lecture — 24 octobre

- Ajout du contrôle **Hear the incoming audio sample**, coupé par défaut et modifiable pendant le test. Sa branche de sortie est indépendante des trames envoyées à la transcription ; l’arrêt la déconnecte avant d’attendre le vidage du worklet.
- Le dernier mot traduit reçu est encadré, y compris pour les écritures sans espaces. Les derniers mots restent visibles dans les longues lignes ; le repère demeure présent sans animations. Ce suivi n’est pas un alignement audio mot à mot.
- Vérification silencieuse avec Web Audio simulé : bascule active/coupée sans redémarrage du fichier, transcription inchangée, coupure immédiate à l’arrêt. Rendu réel du composant vérifié à 980 et 390 px avec texte long : un seul repère, visible, sans débordement horizontal. Le contrôle Tauri natif supplémentaire n’a pas pu être vérifié : « Sky Computer Use native pipe closed before response ». Aucune sortie sonore réelle ni nouveau test fournisseur pour cette itération.
- Typecheck, lint serveur, 13 tests de scripts, 18 tests serveur, 61 tests desktop, builds serveur et Vite réussis.

## Réglages de la barre flottante — 24 octobre

- **Settings → Floating captions** : neuf placements, glisser-déposer dans l’aperçu, déplacement au clavier, trois tailles, thèmes sombre/clair/transparent, opacité, couleur et retour aux valeurs par défaut. Préférences validées et enregistrées localement ; indication de contraste et cibles tactiles de 44 px.
- Vérification du vrai composant React dans un navigateur isolé à 760 et 390 px : onglet accessible, aperçu dans ses limites sans débordement horizontal, préréglages, flèches, déplacement par événements de pointeur, opacité, couleur du thème clair et réinitialisation. La capture du pointeur est simulée dans ce harnais ; ce contrôle ne valide pas le geste matériel ni le compositeur macOS. Aucun micro, son ni appel fournisseur.
- Quatre tests de préférences couvrent valeurs invalides, bornes, déplacement, persistance, erreurs de sauvegarde et contraste. Cinq tests Rust de sous-titres couvrent aussi les anciennes mises à jour, les coordonnées invalides et la géométrie sur écrans étroits, Retina et moniteurs à origine négative.
- Typecheck, lint serveur, suite de tests, builds serveur/Vite et bundle macOS debug réussis. Cargo check, tests (trois tests matériels ignorés) et Clippy `--all-targets --all-features -D warnings` passent. Le module Rust modifié passe rustfmt ; `cargo fmt --check` global signale du formatage déjà présent dans `audio_route.rs` et `system_microphone.rs`, laissés hors périmètre.
- Le placement réel au-dessus d’un appel, les transitions entre Spaces/plein écran et la persistance entre fenêtres WebView restent à confirmer manuellement. Les tests du navigateur appliquent les préférences à un aperçu local ; ils ne remplacent pas ce contrôle natif.

## Toast d’appel dès la salle d’attente, au-dessus des apps — 24 octobre

La détection compte aussi l’application d’appel au premier plan quand une caméra filme (une app qui tient le micro reste prioritaire) et reconnaît davantage d’applications d’appel et de navigateurs. Le toast devient un panneau macOS non activant, au niveau des fenêtres d’état, qui glisse depuis la droite de l’écran sous le pointeur.

- Tests Rust : 27 réussis (3 tests matériels ignorés), dont l’attribution caméra/premier plan, la priorité de l’app qui tient le micro et les nouveaux identifiants d’apps. Une revue indépendante a écarté un maintien de l’appel par n’importe quelle caméra (appel jamais terminé, nouvel appel non annoncé) et une attribution à l’app au premier plan plutôt qu’à celle du micro ; les deux sont corrigés. La sonde native a été exécutée : champs caméra et premier plan lus sans demande d’autorisation ; la caméra n’a pas été allumée pour ce test.
- Un exécutable de test isolé a vérifié la conversion du panneau sur une sous-classe de `NSWindow` à variables d’instance : même taille d’instance pour `NSWindow` et `NSPanel` sur ce Mac, variable préservée, style non activant, niveau 25, pas de focus clavier à l’affichage, position finale atteinte après l’animation, départ réduit quand un autre écran se trouve à droite.
- Non vérifié : affichage réel au-dessus de Meet/Zoom en plein écran, détection dans une vraie salle d’attente et rendu visuel de l’animation. L’app de développement de l’utilisateur occupait déjà les ports et la capture d’écran n’est pas autorisée dans cet environnement.

## Micro au nom de l’app et activation simplifiée — 24 octobre

Le microphone public **Interprete** utilise le nom configuré de l’app, un UID propre et un agrégat limité au pilote BlackHole 2ch. Un test natif a confirmé sa présence avec deux canaux d’entrée et deux de sortie à 48 kHz. Le chemin de lecture injecte directement le pilote sous-jacent, sans imposer la période de l’agrégat : cela corrige un blocage observé lors d’une répétition d’ouverture concurrente entrée/sortie.

- Plusieurs ouvertures natives répétées ont réussi avec silence numérique uniquement ; les callbacks d’entrée livrent des trames. Le micro système est resté inchangé pendant ces tests. Le test de bascule/restauration utilise des adaptateurs simulés, sans enregistrer le micro physique ni modifier l’entrée système de l’utilisateur.
- Les tests de préférences couvrent la migration des anciens choix BlackHole vers Interprete, le mode test mémorisé et l’exclusion du micro virtuel comme source physique.
- Les tests de propriété du micro couvrent arrêt/fermeture, choix manuel prioritaire, activation en échec, micro précédent débranché, reprise après crash, propriétaire encore vivant, PID réutilisé et ancien propriétaire ne pouvant écraser un nouveau.
- La capture démarre après activation explicite ; l’entrée système ne bascule qu’après la capture et la transcription prêtes. Les exemples synthétiques ne basculent pas l’entrée système. La fermeture native et les signaux d’arrêt attendent la restauration, y compris en cas de demandes d’arrêt répétées.
- L’écran a été contrôlé visuellement sur le composant isolé rendu avec les styles compilés. La page authentifiée du navigateur se trouvait dans l’onboarding ; aucun compte ni consentement de voix n’a été modifié. Ce contrôle isolé ne prouve pas une session native complète ; les tests natifs de bascule réelle pendant un appel, de plein écran et d’acoustique restent non effectués.

Après intégration avec l’interface Réunion en ligne et la traduction entrante : typecheck, lint serveur, 10 tests de configuration/cycle de vie, 18 tests serveur et 56 tests desktop passent. Les builds serveur/Vite et le bundle macOS debug passent, ainsi que Cargo check/fmt/Clippy (`--all-targets --all-features -D warnings`) et 25 tests Rust (3 tests matériels ignorés par défaut). Le test matériel silencieux du micro **Interprete** a également été exécuté : trames livrées, entrée et sorties système inchangées. Le ton de test et la capture du son système n’ont pas été exécutés.

L’interface fusionnée a été vérifiée dans Chrome avec capture, réseau et commandes natives simulés/bloqués : bouton d’activation visible, détails repliés, choix Interprete, conservation du mode casque et du choix de bascule après rechargement. Les deux tentatives de capture du navigateur intégré ont expiré. Cette vérification ne prouve pas la bascule réelle dans Meet/Zoom ni l’acoustique native.

## Web et backend sur Vercel — 24 octobre

- `interprete-live.vercel.app` sert le build Vite et utilise `interprete-backend.vercel.app`. Les domaines de production ont été vérifiés par HTTP et l’onboarding/écran de connexion dans Chrome. Les deux inspections du navigateur intégré ont échoué par timeout avant ce contrôle Chrome.
- L’entrée Hono Vercel est un bundle ESM ; le premier essai TypeScript non bundlé échouait à résoudre `src/auth`. Le bundle est vérifié localement par une requête `/api/status`, puis les endpoints publics `/api/status` et `/api/auth/ok` répondent 200 en production avec l’origine web autorisée.
- Création puis connexion d’un compte entièrement synthétique via Better Auth, lecture de `account.me`, écriture et relecture des préférences via oRPC/PostgreSQL réussies. Le compte temporaire et ses données liées ont été supprimés après le test. La vérification des migrations Neon est passée.
- Un jeton éphémère de transcription a été obtenu et une courte phrase synthétique a renvoyé du texte et des paquets audio en SSE jusqu’à l’événement de fin, sans erreur. Aucun micro physique ni haut-parleur n’a été utilisé. Les clés fournisseurs n’ont pas été retrouvées dans le bundle web servi.
- TypeScript, lint serveur, 10 tests de configuration/cycle de vie, 13 tests serveur et 36 tests desktop réussis ; build Vite et bundle Hono Vercel réussis. Les fonctions de détection système, fenêtre flottante native et micro virtuel restent propres à Tauri ; aucun build natif n’a été nécessaire pour ce déploiement web.

## Intégration avec les comptes et l’onboarding — 24 octobre

- L’intégration conserve les écrans de connexion/onboarding et leur contrôleur partagé, avec des routes indépendantes pour les fenêtres `#call-toast` et `#translation-overlay`.
- `pnpm dev` réutilise l’orchestrateur backend avec l’option `--desktop` : PostgreSQL et les migrations précèdent le démarrage de l’API et de Studio ; l’app Tauri attend le message d’écoute de l’API. Les tests de cycle de vie vérifient le démarrage, l’ordre, l’interruption, la fermeture normale de l’app, les erreurs et la conservation du volume avec des exécutables simulés. Aucun lancement réel de Docker n’a été effectué pour cette intégration.
- TypeScript, lint serveur, 8 tests de cycle de vie, 13 tests serveur et 35 tests desktop passent après intégration des contrôles explicites de microphone de `main`. Les builds serveur et Vite ont été revérifiés sur cet ensemble. Le bundle macOS de développement et les 11 tests Rust passent sur le snapshot natif inchangé ; le test matériel reste ignoré par défaut. Les résultats matériels et natifs de la version locale ci-dessous restent distincts de ces vérifications d’intégration.

## Commande unique et pastille flottante — 24 octobre

- Avant intégration du backend PostgreSQL, la commande unique démarrait l’API, Vite et l’app Tauri. Démarrage natif et réponses HTTP 200 sur les ports 3035/1420 vérifiés ; `Ctrl+C` libérait les deux ports. Ces observations concernent la commande précédente, sans PostgreSQL ni Studio.
- Nouvelle fenêtre transparente indépendante, ovale, à droite de l’écran, avec état, langues et bouton d’arrêt. L’indicateur suit l’identifiant de session réel, reste pendant la restitution finale et disparaît à l’arrêt. Les modes conversation et appel utilisent un seul propriétaire de la pastille.
- **Tester la pastille** ne capture aucun audio et n’appelle aucun fournisseur. Son affichage et sa fermeture par le bouton carré ont été vérifiés dans Chrome ; aucun son de test n’a été émis.
- 41 tests TypeScript et 11 tests Rust passent, ainsi que TypeScript, ESLint, Clippy avec avertissements bloquants et le build Vite. Les nouveaux tests couvrent l’arrêt d’une session précise, les mises à jour d’état concurrentes, l’aperçu, la fin de session et les anciens instantanés et l’arrêt retardé d’une session remplacée. La fenêtre est configurée pour ne pas prendre le focus et accepter le premier clic ; l’arrêt est revérifié contre le propriétaire réel dans le contrôleur appel comme dans le contrôleur conversation. Le test matériel BlackHole reste ignoré par défaut et n’a pas été réexécuté pour ce changement d’interface.
- L’automatisation native reste indisponible (`cgWindowNotFound`) ; le navigateur intégré a aussi échoué deux fois par timeout. La validation visuelle au-dessus d’une autre application ou d’une fenêtre plein écran n’est donc pas confirmée par l’automatisation. La revue de code indépendante a validé les corrections de focus, de clic initial et d’arrêt ciblé après remplacement de session ; aucun blocage supplémentaire n’a été identifié.

## Mode appel sur macOS — 24 octobre

Voir [le guide de configuration et de test](CALL-MODE.md). Le mode appel conserve l’architecture de transcription/traduction/synthèse existante et ajoute une détection CoreAudio, un toast natif de confirmation, la sélection d’un micro physique et une sortie PCM native vers BlackHole.

- 37 tests TypeScript et 7 tests Rust réussis ; TypeScript, ESLint, Clippy avec avertissements bloquants, build Vite, build serveur et bundle macOS de développement réussis.
- La sonde de processus et l’énumération native des périphériques ont été exécutées sur le Mac. La détection exclut les processus WebKit génériques de l’app elle-même ; les transports d’entrée virtuels et agrégés sont exclus par CoreAudio.
- Parcours navigateur réel : exemple synthétique français → traduction anglaise terminée et retour à l’état micro arrêté ; Échap pendant le démarrage puis nouvelle tentative réussie.
- Deux vérifications silencieuses avec les vrais fournisseurs : entrée synthétique de 4,23 s ; premier texte à 1,72 s / 1,64 s ; premier signal vocal planifié à 2,75 s / 3,85 s, avant la fin de l’entrée. Aucun micro physique utilisé. Ce sont deux observations, sans mesure acoustique ni statistiques P50/P95.
- Régressions spécifiques : paquets PCM impairs, annulation d’ouverture native, vidage de sortie, erreurs fatales de périphérique, rejet d’un agrégat au nom personnalisé, segment audio de 24 secondes conservé intégralement par contre-pression, et consommation SSE qui attend la livraison audio. Un test du contrôleur vérifie que le segment suivant démarre alors que plus de trois secondes du précédent restent à lire sur la sortie virtuelle.
- BlackHole 2ch 0.7.1 a été installé avec accord explicite. Après un premier échec dû au pilote non chargé, le service CoreAudio a été redémarré avec accord explicite : le périphérique apparaît alors avec deux canaux d’entrée et de sortie à 48 kHz. Le test matériel `pnpm test:virtual-mic` a **réussi** : 145 664 trames reçues, composante synthétique de 997 Hz mesurée à une amplitude de 0,131. Cela confirme le chemin de sortie natif → entrée du microphone virtuel. Le test reste ignoré dans la suite ordinaire car il requiert le pilote installé. Une réunion Meet / Zoom réelle n’a pas été utilisée.
- Le redémarrage de CoreAudio a modifié les sorties par défaut et interrompu le son de l’utilisateur. La sortie audio et la sortie des sons système ont été remises sur le casque Bluetooth précédemment sélectionné, puis vérifiées via CoreAudio ; le volume existant de 69 % a été conservé. Les tests audio ont ensuite été arrêtés.
- La vérification visuelle du toast macOS, du plein écran et d’une session minimisée de longue durée n’a pas pu être exécutée : l’automatisation native renvoie `cgWindowNotFound` pour toutes les applications testées. Le bundle compile, mais cela ne constitue pas une preuve visuelle de ces états.
- Les changements restent locaux sur `main`, sans commit ni push. Greptile n’a pas été exécuté : aucun commit non fusionné n’existe par rapport à `origin/main`, et ce CLI ignore les changements non committés. Trois passes de revue indépendante ont été effectuées. Les huit défauts initiaux puis les corrections de continuité, d’annulation et de notifications d’activité ont été résolus et couverts par les tests ciblés ; la dernière petite course du timer d’activité a aussi été corrigée avec un accusé natif retardé en test.

## Conversation continue — correction du 23 octobre

Suppression de l’arrêt automatique à la pause et du plafond de 45 secondes. La capture ne ferme plus le micro lors de la finalisation d’un item ASR, de la lecture, du clonage ou du renouvellement de connexion. Les items sont associés à leurs identifiants, les sockets sont préparées puis remplacées après 45 minutes, et les coupures réseau sont réessayées avec un tampon limité à 60 secondes. Les 30 derniers passages et trois réécoutes sont conservés.

Test réel silencieux de cette correction : 18 secondes de PCM, renouvellements volontairement forcés toutes les 7 secondes et checkpoints toutes les 4 secondes. Premier texte à 1,47 s ; premier signal vocal planifié à 3,74 s pendant la capture ; aucun arrêt ni erreur. Ces intervalles courts servent à tester le renouvellement, pas à mesurer la qualité de traduction. Le réglage normal reste 30 secondes / 45 minutes. Aucune session de plusieurs heures n’a été exécutée. La revue indépendante a également conduit à corriger le seuil du tampon WebSocket lors d’une reprise ; un test rejoue 20 secondes de PCM sans boucle de reconnexion.

## Lecture continue — vérification précédente

La lecture ne dépend plus de l’arrêt du micro : capture et connexion démarrent ensemble, les trames font 20 ms, et les segments autorisés sont joués dès réception. La validation finale traite uniquement le texte restant, sans relire les segments déjà prononcés. Les échantillons destinés au clonage excluent les périodes de sortie audio.

Vérification silencieuse avec les vraies API OpenAI, Jev et ElevenLabs, une source synthétique envoyée au rythme réel et un lecteur simulant la file audio sans haut-parleur : sur 18 secondes d’entrée, premier texte à **1,24 s**, premier signal vocal planifié à **2,46 s**, pendant que l’entrée continuait. Ce sont les mesures d’un essai, pas un P50/P95 ni une mesure acoustique en salle.

Les régressions couvrent la sortie avant arrêt de capture, le démarrage parallèle avec conservation des premières trames, l’annulation pendant la connexion, la non-répétition des segments, les corrections de ponctuation/flexion finales et les préfixes ambigus (négation, nombre incomplet, préposition). Des cas de continuation négative ont également été vérifiés contre le modèle réel afin d’éviter une double négation.

L’annulation d’écho est demandée au navigateur, avec le mode `all` lorsqu’il est disponible. Son efficacité sur le microphone et les haut-parleurs réels reste à vérifier : aucun son n’a été émis sur l’ordinateur pendant cette correction, conformément à la demande de l’utilisateur.

## Parcours réels de la première version (attente de fin de tour)

- Navigateur : audio de démonstration français → OpenAI Realtime transcription → traduction anglaise → ElevenLabs → lecture et bouton de réécoute.
- Sens inverse : anglais → français, puis retour au profil A.
- Démarrage observé de la lecture : **1,5 s** et **1,4 s** après la fin de l’entrée audio. La pause de détection automatique d’une voix réelle s’ajoute à ce délai. Ces deux essais ne sont pas un P50/P95.
- Clonage réel d’un **échantillon entièrement synthétique de 31,05 s**, puis synthèse de la traduction anglaise avec ce clone et suppression de la voix de test confirmée.
- Première création : **13,8 s** ; premier paquet de synthèse avec ce clone : **1,85 s** depuis la requête de traduction. Création d’un second clone de test : **3,56 s**. La création est asynchrone et ne bloque pas la traduction avec la voix provisoire.
- Nouvelle demande pour le même profil : clone existant récupéré en **332 ms**, sans création supplémentaire ; suppression de cette deuxième voix de test confirmée.
- Aucun enregistrement d’une personne réelle n’a été utilisé pour ces tests. La ressemblance avec une voix humaine donnée reste à valider avec son accord et un échantillon réel.

## Contrôles

Tests unitaires des sessions signées, voix scindées par personne/session, autorisations, limites, validation, flux réseau interrompus et clonage avec consentement. TypeScript, ESLint et build de production vérifiés.

La refonte réalisée avec Claude Code / Opus 5.5 High a été contrôlée sur ordinateur et mobile (390 px), avec état vide, traductions, réglages et annulation. Les deux sens ont été réessayés après refonte : démarrage audio observé à 1,3 s et 1,5 s. Une revue indépendante a validé la version après correction du suivi du défilement, du raccourci Échap et du texte des tours interrompus.

Les 27 tests de l’app et les 4 tests de métriques du benchmark passent. TypeScript, ESLint et le build de production passent. Les clés et fichiers d’échantillons personnels sont exclus de Git ; le dépôt GitHub est privé.

## Limites connues

- Les changements de voix prennent effet dès la demande de synthèse suivante.
- La voix de départ est choisie parmi trois presets ; la sélection automatique du timbre le plus proche n’est pas incluse.
- Seul le bouton Terminer clôt volontairement la prise de parole. Une déconnexion physique du microphone ou la fermeture/mise en veille de la page nécessite une nouvelle capture. Une panne réseau supérieure au tampon ne peut pas être rendue sans perte.
- La détection des locuteurs est manuelle via les boutons A/B. Pas de séparation de deux voix qui parlent en même temps.
- L’application doit conserver la protection Vercel tant qu’elle n’a pas d’authentification et de quotas distribués propres.
- Le cookie et les autorisations de voix expirent après 30 jours. Les voix hébergées chez ElevenLabs ne sont pas automatiquement supprimées à l’expiration du cookie.

## Progressive live words — 2026-10-25

Presentation only: conversation source/translation and floating captions now share
word-level CSS reveals (35 ms cadence, compressed to a 240 ms start window, 80 ms
fade). Completed text and reduced motion are immediate. Controller timestamps in
Benchmark remain text-availability measurements, not painted reveal measurements.

- `pnpm typecheck`, `pnpm lint` (server), `pnpm test` (13 script, 29 server,
  114 desktop tests), `pnpm build:server`, desktop static build and diff whitespace
  checks passed. The static build retains its large-chunk warning.
- Silent synthetic browser checks at 1280 and 390 px passed: batch staggering,
  stable appended-word DOM identity, revision, session replacement, completion,
  reduced motion, full accessible text, Chinese segmentation, unmount cancellation
  and no horizontal page overflow. Screenshots were inspected locally.
- T3 preview snapshots timed out twice; Playwright loaded the actual components
  through the existing Vite server in an isolated synthetic page. No microphone,
  speaker output, provider request or benchmark run was used. Native rendering,
  screen-reader speech and frame-rate guarantees remain unverified.
