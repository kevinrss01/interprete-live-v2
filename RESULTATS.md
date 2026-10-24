# Traduction vocale instantanée : rapport des essais

État des mesures : 23 octobre 2026. Résultats locaux sur 12 enregistrements humains, en français, anglais et espagnol. Ce rapport ne prétend pas désigner le moteur universellement le plus rapide.

## Ce que je retiens

- **Synthèse vocale : Eleven Flash parle plus tôt dans ce test**, malgré un premier paquet plus rapide chez Cartesia. Début de parole simulé médian : 147 ms contre 219 ms pour Cartesia. Premier paquet : 114 ms et 97 ms respectivement. La métrique utile dépend donc du contenu audio, pas seulement du premier octet.
- **Traduction texte : Gemini 3.5 Flash Lite et GPT-5.4 nano sont proches.** Premier token médian 562 ms et 567 ms, via AI Gateway. L'écart entre ces médianes ne suffit pas à prouver une supériorité générale.
- **Jev est un décideur rapide, pas un générateur de traduction libre.** 238 ms médian pour décider; 91.7 % d'accord avec les étiquettes du petit corpus construit. Il valide trop tôt « Le prix est de cent », qui peut se prolonger en « cent vingt-cinq ».
- **La stabilité du texte est déterminante.** Prononcer un résultat provisoire erroné peut produire une traduction incohérente, même si la transcription finale devient correcte. Attendre les énoncés finaux augmente le retard.
- **OpenAI Realtime Translate reste une référence utile**, mais les paquets initiaux silencieux ne sont pas un début de traduction audible. Le tableau des chaînes utilise le signal vocal détecté, pas leur arrivée.

## Transcription

Les émissions sont comparées sur l'intersection des mots correctement reconnus par tous les fournisseurs, avec un alignement automatique de référence. Les mots erronés restent dans la WER et ne sont pas récompensés comme des émissions rapides. La WER est lexicale, sensible aux chiffres versus nombres écrits en lettres. Les échecs de transport sont comptés séparément.

| Moteur | OK / essais | Retard mot p50 (ms) | p95 (ms) | WER (%) | Mots communs |
| --- | --- | --- | --- | --- | --- |
| deepgram-flux | 36 / 36 | 234 | 605 | 11.0 | 654 |
| speechmatics | 36 / 36 | 372 | 638 | 7.9 | 654 |
| openai-live-minimal | 36 / 36 | 387 | 545 | 12.9 | 654 |
| gladia | 36 / 36 | 491 | 2 401 | 12.0 | 654 |
| openai-live-low | 36 / 36 | 698 | 891 | 10.5 | 654 |
| eleven-scribe | 36 / 36 | 909 | 1 663 | 9.0 | 654 |
| cartesia-ink | 36 / 36 | 1 013 | 1 150 | 4.9 | 654 |

## Voix

Trois textes en EN/FR/ES, trois répétitions finales par moteur. PCM 24 kHz, mêmes textes, voix propres à chaque service. La négociation de session OpenAI est incluse.

| Moteur | OK / essais | Paquet p50 (ms) | Parole p50 (ms) | Parole p95 (ms) |
| --- | --- | --- | --- | --- |
| eleven-flash | 9 / 9 | 114 | 147 | 185 |
| cartesia-sonic | 9 / 9 | 97 | 219 | 281 |
| openai-legacy-tts | 9 / 9 | 477 | 1 049 | 16 304 |
| openai-realtime-tts | 9 / 9 | 1 197 | 1 232 | 1 343 |
| fish-s2-pro | 0 / 9 | — | — | — |

Fish Audio : crédit API insuffisant, aucune mesure audio exploitable. Aucun rechargement effectué. OpenAI mini TTS est un ancien modèle, annoncé en arrêt le 6 janvier 2027 ; il est séparé de Realtime 2.1 mini. Les résultats ne constituent pas un classement subjectif de naturel vocal.

## Traduction texte

| Modèle | OK / essais | Premier token p50 (ms) | p95 (ms) | Texte complet p50 (ms) | Coût observé USD |
| --- | --- | --- | --- | --- | --- |
| google/gemini-3.5-flash-lite | 36 / 36 | 562 | 885 | 679 | 0.00328 |
| openai/gpt-5.4-nano | 36 / 36 | 567 | 852 | 837 | 0.00201 |
| openai/gpt-oss-20b | 36 / 36 | 635 | 1 195 | 845 | 0.00042 |
| openai/gpt-4.1-nano | 36 / 36 | 949 | 3 078 | 1 370 | 0.00072 |

Les coûts ci-dessus proviennent des réponses AI Gateway et couvrent uniquement ces essais texte. Ils ne sont pas le coût de la chaîne audio complète.

## Décision : Jev contre OpenAI

12 fragments construits, dont six complets et six incomplets, répétés trois fois. Ce test n’établit pas la calibration des probabilités ni la précision en conversation générale.

| Modèle | Accord (%) | Décision p50 (ms) | p95 (ms) | Départs prématurés |
| --- | --- | --- | --- | --- |
| typesafe-ai/jev-1.14.0 | 91.7 | 238 | 347 | 3 |
| openai/gpt-5.4-nano | 97.2 | 696 | 1 246 | 0 |
| openai/gpt-4.1-nano | 80.6 | 1 248 | 4 606 | 7 |

## Predicted Outputs

Même modèle GPT-4.1 nano, mêmes instructions et paramètres, même API directe OpenAI. La seule différence est la traduction précédente fournie dans `prediction`. 18 paires, six cas distincts; ordre alterné.

| Condition | Essais | Premier token p50 (ms) | Complet p50 (ms) | p95 (ms) | Jetons acceptés / rejetés |
| --- | --- | --- | --- | --- | --- |
| Control | 18 | 451 | 559 | 634 | 0 / 0 |
| Predicted Outputs | 18 | 437 | 517 | 583 | 90 / 63 |

Gain moyen apparié du temps complet (positif = prédiction plus rapide) : **30 ms**. Intervalle bootstrap exploratoire à 95 %, rééchantillonné par cas : **-8 à 59 ms**. Six cas seulement : cela ne démontre pas un gain général en conversation.

## Trajet direct ou AI Gateway

Même GPT-4.1 nano, trois textes, quatre répétitions appariées. Les fournisseurs peuvent utiliser des capacités et routages différents : ce résultat ne mesure pas un simple coût de proxy.

| Trajet | Essais | Premier token p50 (ms) | p95 (ms) | Complet p50 (ms) |
| --- | --- | --- | --- | --- |
| OpenAI direct | 12 | 536 | 749 | 709 |
| AI Gateway | 12 | 1 041 | 7 296 | 1 241 |

## Chaînes complètes

Même intersection de six fichiers pour tous les bras. Deux essais par fichier en profil agressif; un en profil finals. Temps rapportés au début de parole source estimé. La file de lecture est simulée à partir des vrais paquets PCM. Un premier paquet négatif peut être du silence renvoyé avant la parole source.

| Chaîne | OK / essais | Extraits | Premier paquet p50 (ms) | Parole p50 (ms) | Parole p95 (ms) | Retard final p50 (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| speechmatics → google/gemini-3.5-flash-lite → cartesia-sonic | 12 / 12 | 6 | 1 468 | 1 601 | 8 242 | 10 837 |
| openai-native | 12 / 12 | 6 | 27 | 2 404 | 3 704 | 3 077 |
| openai-live-minimal → google/gemini-3.5-flash-lite → eleven-flash | 12 / 12 | 6 | 2 497 | 2 527 | 3 151 | 3 612 |
| deepgram-flux → google/gemini-3.5-flash-lite → cartesia-sonic | 11 / 12 | 6 | 2 431 | 2 591 | 3 112 | 4 416 |
| gladia → google/gemini-3.5-flash-lite → eleven-flash | 12 / 12 | 6 | 3 166 | 3 216 | 3 837 | 3 651 |
| cartesia-ink → google/gemini-3.5-flash-lite → eleven-flash | 12 / 12 | 6 | 3 255 | 3 305 | 3 989 | 3 547 |
| cartesia-ink → google/gemini-3.5-flash-lite → cartesia-sonic | 12 / 12 | 6 | 3 307 | 3 437 | 3 932 | 5 098 |
| gladia → google/gemini-3.5-flash-lite → cartesia-sonic | 12 / 12 | 6 | 3 422 | 3 562 | 4 463 | 4 462 |
| gladia → google/gemini-3.5-flash-lite → eleven-flash (finals) | 6 / 6 | 6 | 5 006 | 5 066 | 6 345 | 5 061 |
| cartesia-ink → google/gemini-3.5-flash-lite → eleven-flash (finals) | 6 / 6 | 6 | 7 657 | 7 697 | 9 117 | 6 324 |

Le profil agressif peut lire une mauvaise transcription qui sera corrigée plus tard. Le délai de premier son n'est donc pas une preuve d'utilité. Le retard final révèle également les files de lecture qui s'accumulent. Un échec de concurrence chez Deepgram est conservé dans les tentatives; aucun essai raté n'est converti en zéro milliseconde.

## Vérification du sens

Un évaluateur GPT-6.1 Sol a comparé les textes aux sources et à des traductions humaines du corpus. Il s'agit d'un repérage automatisé d'erreurs, pas d'une validation humaine. Le tableau porte sur les sorties distinctes et les couvertures diffèrent : il ne faut pas comparer les taux comme un classement statistique homogène.

| Modèle / chaîne | Textes distincts | Note moyenne / 4 | Alertes graves |
| --- | --- | --- | --- |
| google/gemini-3.5-flash-lite | 17 | 3.94 | 0 |
| openai/gpt-5.4-nano | 32 | 3.78 | 0 |
| openai/gpt-oss-20b | 31 | 3.71 | 1 |
| openai/gpt-4.1-nano | 30 | 3.63 | 0 |
| openai-native | 24 | 2.71 | 7 |
| gladia → google/gemini-3.5-flash-lite → eleven-flash | 11 | 2.09 | 6 |
| gladia → google/gemini-3.5-flash-lite → cartesia-sonic | 11 | 2.09 | 6 |
| cartesia-ink → google/gemini-3.5-flash-lite → eleven-flash | 13 | 3.23 | 2 |
| openai-live-minimal → google/gemini-3.5-flash-lite → eleven-flash | 12 | 2.33 | 6 |
| cartesia-ink → google/gemini-3.5-flash-lite → eleven-flash (finals) | 6 | 3.67 | 0 |
| gladia → google/gemini-3.5-flash-lite → eleven-flash (finals) | 6 | 3.5 | 0 |
| speechmatics → google/gemini-3.5-flash-lite → cartesia-sonic | 12 | 1.67 | 4 |
| cartesia-ink → google/gemini-3.5-flash-lite → cartesia-sonic | 12 | 3.17 | 0 |
| deepgram-flux → google/gemini-3.5-flash-lite → cartesia-sonic | 11 | 2.18 | 5 |

Exemples importants relus :

- L'énoncé français sur le rugissement du tigre est difficile pour plusieurs transcripteurs. Certaines sorties natives inventent un déplacement ou une retouche de couleur : la traduction ne conserve plus le sens.
- Sur « on ne devrait cependant pas leur demander d'assumer des obligations… », Gladia peut commencer par un texte provisoire parlant de monnaie et de coups. Le profil agressif le prononce, bien que le texte final retrouve la bonne phrase.
- Le cas anglais sur les noms et le pronom allemand « Sie » peut devenir une phrase sans rapport dans la traduction native. Cette erreur ne se voit pas dans la seule mesure de vitesse.

## Choix recommandé pour la suite

Conserver **deux voies** dans le laboratoire : la traduction native OpenAI comme référence d'interprétation continue, et une chaîne modulaire avec des moteurs interchangeables. Pour cette dernière, Speechmatics est un candidat de compromis et Cartesia Ink 2 un candidat de précision; Deepgram est un candidat de vitesse. Gemini Flash Lite et GPT-5.4 nano méritent d'être conservés côté traduction. Eleven Flash est le premier choix vocal de ces essais sur le début de parole; Cartesia reste compétitif.

Ne pas mettre Jev sur chaque mot par défaut. Le tester comme validateur de clauses avec un contrôle sans évaluateur. Ne pas généraliser le gain des Predicted Outputs à une prédiction de ce que l'interlocuteur va dire. Avant le choix de production : écoute bilingue des deux finalistes, conversation continue, négations/nombres et réseau du déploiement. Le présent rapport est une présélection instrumentée, pas cette validation finale.

## Méthode, limites et reproduction

- Douze fichiers humains de 4–15 secondes, trois langues. Pas de réseau mobile ni d'interface Vercel dans cette mesure.
- Références parallèles FLEURS; gain audio linéaire commun et rééchantillonnage avant tous les fournisseurs. Transcriptions et traductions humaines conservées avec SHA-256 des entrées.
- La fin et le début des mots sources sont estimés par alignement automatique ElevenLabs, non annotés manuellement.
- Les trames historiques étaient horodatées à leur premier envoi. L'analyse ajoute leur durée de capture : 80 ms pour Deepgram, 100 ms ailleurs. Les deux métriques de sortie partagent le même repère.
- Détection de parole sortie : RMS sur trames de 20 ms, seuil max(0,015; 5 % du pic), quatre trames actives sur cinq, avec première trame active. La sortie est mise dans une file de lecture continue simulée. Aucune précision acoustique inférieure à 20 ms n'est revendiquée.
- WER lexicale pondérée, sensible à certaines normalisations de nombres. Vitesse comparée sur l'intersection des mots reconnus; c'est pourquoi la WER est indispensable à côté.
- Les p95 sont exploratoires. Des répétitions sur les mêmes douze phrases ne sont pas des observations linguistiques indépendantes.
- Plusieurs sessions indépendantes ont partagé les comptes et la connexion. Le classement ne garantit pas une capacité ou une latence en production.
- Fish : quota financier API insuffisant. Soniox et AssemblyAI : pas de clé disponible dans le périmètre fourni; pas d'essai prétendu.
- Les fichiers PCM et les journaux complets sont dans `benchmark-results/`; `BENCHMARK.md` donne les commandes. Les secrets sont exclus du rapport et des exports.

Sources primaires : [FLEURS](https://huggingface.co/datasets/google/fleurs), [OpenAI Realtime Translate](https://developers.openai.com/api/docs/guides/realtime-translation), [OpenAI Live Transcribe](https://developers.openai.com/api/docs/guides/realtime-transcription), [Predicted Outputs](https://developers.openai.com/api/docs/guides/predicted-outputs), [Cartesia](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest), [ElevenLabs](https://elevenlabs.io/docs/overview/models), [Speechmatics](https://docs.speechmatics.com/speech-to-text/realtime/quickstart), [Deepgram Flux](https://developers.deepgram.com/docs/flux/quickstart).
