# Traduction vocale instantanée : protocole de comparaison

Date de recherche : 23 octobre 2026. Ce document propose les expériences ; aucun vainqueur de latence n'est encore établi.

## Objectif et périmètre

Construire d'abord un banc d'essai qui compare des architectures complètes sur le même audio, puis transformer les deux meilleures en application Next.js / Tailwind déployée sur Vercel. L'utilisateur a demandé de passer par un plan et des comparaisons avant de poursuivre l'application. Il a décliné le brainstorming et autorisé le test de Cartesia.

Le navigateur capture et joue l'audio. Les modèles, la traduction et les traitements de média s'exécutent sur des serveurs. Une connexion directe au fournisseur avec un jeton éphémère évite un relais inutile ; les clés permanentes restent côté serveur. Les tests déterminent si un worker audio distinct apporte un avantage. Le traitement vidéo et les appels à plusieurs participants restent hors du premier benchmark.

Critère principal : le délai jusqu'à une traduction effectivement audible et correcte. Un premier paquet audio, un premier caractère provisoire ou une réponse erronée ne suffisent pas.

## Ce qui est vérifié

- Création d'une session Gladia Solaria-1 : HTTP 201 avec la clé existante. Aucun test audio comparatif effectué.
- Accès à la bibliothèque vocale ElevenLabs : HTTP 200. Aucun test TTS comparatif effectué.
- Création d'un secret de session `gpt-realtime-translate` : HTTP 200 avec la clé OpenAI existante du projet VoiceCheap. Cela vérifie l'accès à la création de session, pas encore un aller-retour audio complet.
- Clés AI Gateway, Speechmatics, Deepgram et Fish Audio présentes dans les fichiers autorisés. Leur présence ne prouve pas l'accès à tous les modèles.
- Aucune clé Cartesia trouvée dans le dossier indiqué. Kevin a autorisé l'ajout de Cartesia aux essais ; le compte et sa clé restent à connecter.
- Aucun déploiement Vercel effectué pour cette application.

### Jev : une expérience réelle

Modèle exact : `typesafe-ai/jev-1.14.0`, endpoint AI Gateway `POST /v1/evaluate`.

État : « The French speaker said: Bonjour. Target language: English. »

Question : choisir la traduction anglaise parmi quatre candidats fournis dans la requête.

```json
{
  "criteria": {
    "hello": "Hello",
    "goodbye": "Goodbye",
    "thank_you": "Thank you",
    "good_night": "Good night"
  }
}
```

Réponse observée :

```json
{
  "type": "choice",
  "choice": "hello",
  "probabilities": {
    "hello": 1,
    "goodbye": 0,
    "thank_you": 0,
    "good_night": 0
  },
  "confidence": 1
}
```

Un seul appel depuis cette machine : 801 ms, HTTP 200. Ce temps comprend le trajet HTTP et ne constitue pas une mesure de vitesse d'inférence ni un benchmark statistique. Les probabilités sont des sorties du modèle ; leur calibration sur nos données reste à mesurer.

Une seconde requête demandant une sortie `type: "text"` avec l'instruction de traduire « Bonjour » a été rejetée en HTTP 400 : le schéma accepte `boolean`, `box`, `choice` ou `score`, pas une sortie texte libre.

Conclusion fonctionnelle : Jev peut sélectionner une traduction connue parmi des candidats et peut évaluer si un fragment semble prêt. Il ne fournit pas, sur cette API, un générateur de traduction arbitraire. Générer les candidats avec un autre LLM avant de demander un choix à Jev ajoute du travail ; seul un essai complet peut établir un gain net. Les probabilités des candidats ne sont pas une distribution du prochain mot sur tout le vocabulaire.

## Pistes OpenAI pour la « prédiction »

1. **Petit modèle de décision en JSON** : comparer `gpt-4.1-nano` et `gpt-5.4-nano` sans raisonnement à Jev sur les mêmes décisions : parler maintenant ou attendre, choisir un candidat, reconnaître une clause complète. Ce sont des modèles de génération utilisables comme classifieurs, pas des équivalents spécialisés garantis de Jev. Un champ de confiance généré dans du JSON n'est pas une probabilité calibrée.
2. **Predicted Outputs** : fonctionnalité de Chat Completions, pas un modèle autonome. Fournir une traduction provisoire existante comme `prediction.content` lorsque de nouveaux mots arrivent. Comparer le même `gpt-4.1-nano` avec et sans cette fonctionnalité. Mesurer les jetons acceptés/rejetés et le temps total ; aucune accélération n'est présumée sur des fragments courts. La documentation limite cette fonctionnalité au texte. Vérifier sa transmission effective via AI Gateway ; utiliser OpenAI directement si la fonctionnalité n'est pas prise en charge et étiqueter ce trajet distinctement.
3. **Décodage spéculatif côté application** : préparer traduction et audio à partir de texte provisoire, annuler les versions dépassées et ne jouer que la partie validée. Cette technique peut utiliser Jev ou un petit modèle OpenAI pour décider de la validation ; elle doit aussi être comparée à une règle locale sans appel supplémentaire.

## Candidats et faits de documentation

Les chiffres ci-dessous sont annoncés par les fournisseurs et emploient des définitions différentes. Ils ne permettent pas de déclarer un vainqueur de bout en bout.

| Fonction | Candidat | Motif d'inclusion / limite |
| --- | --- | --- |
| Transcription | Gladia `solaria-1` | Annonce de partiels <103 ms, 100+ langues. Endpointing réglable ; comparaison de texte partiel et de texte final indispensable. |
| Transcription | ElevenLabs `scribe_v2_realtime` | Annonce ~150 ms de partiels, 90+ langues. Sa documentation précise un tampon initial d'environ 2 s : mesurer démarrage et régime continu séparément. |
| Transcription | Speechmatics Realtime | Partiels documentés <500 ms, finals ~0,7–2 s. `max_delay` et endpointing à tester sans confondre leurs métriques. |
| Transcription | OpenAI `gpt-live-transcribe` | Streaming continu, réglages `delay: minimal / low`. L'API et le schéma de session diffèrent des anciens modèles. |
| Transcription | Deepgram Flux Multilingual | 10 langues, dont le français ; détection de tour et événement de fin anticipée. Endpoint `/v2/listen`, paquets de 80 ms recommandés. |
| Transcription | Cartesia `ink-2` | Détection de tour intégrée, mais seulement en/fr/hi/ja/es dans la documentation actuelle. Candidat utile pour le premier couple FR/EN, couverture plus restreinte. |
| Traduction texte | `openai/gpt-4.1-nano` | Petit modèle sans étape de raisonnement ; point de départ à mesurer, pas gagnant déclaré. |
| Traduction texte / décision | `openai/gpt-5.4-nano` | Comparaison en `reasoning: none`, sortie JSON ou texte selon le rôle. |
| Traduction texte | `google/gemini-3.5-flash-lite` | ID présent dans le catalogue AI Gateway ; comparer TTFT, débit et fidélité. Pas de présomption sur la latence. |
| Décision | `typesafe-ai/jev-1.14.0` | Évaluation des mêmes candidats et des décisions de validation ; mesure du coût réseau ajouté. |
| Voix | ElevenLabs `eleven_flash_v2_5` | Annonce ~75 ms d'inférence, 32 langues. Ce chiffre exclut le réseau et le tampon de lecture. |
| Voix | Cartesia `sonic-3.6-2026-08-27` | Snapshot stable, 44 langues et flux texte/audio. Mesurer réellement : les anciens chiffres Turbo 40 ms ne décrivent pas automatiquement Sonic 3.6. |
| Voix OpenAI | `gpt-realtime-2.1-mini` | Candidat Realtime, à configurer pour lire le texte sans le reformuler. Les anciens `tts-1`, `tts-1-hd` et `gpt-4o-mini-tts` sont annoncés en arrêt le 6 janvier 2027 ; ne pas en faire la base d'une nouvelle app. |
| Voix | Fish Audio, accès existant | Comparaison complémentaire si son modèle streaming accessible apporte un intérêt ; résoudre l'ID actuel avant l'essai. |

Réserve utile : Soniox propose la transcription et la traduction texte continues dans une même connexion. Une variante Soniox → meilleur TTS testerait la suppression de l'appel au LLM. Aucun accès Soniox n'est configuré ; ne pas ajouter un abonnement pour ce candidat sans décision de Kevin. AssemblyAI Universal-3.6 Pro est également une réserve, sans ouvrir de compte supplémentaire pour le premier tour.

## Expériences par étapes

### 1. Éliminer les mauvais composants

Comparer les transcripteurs sur les mêmes enregistrements, puis les voix sur les mêmes textes. Comparer les trois petits modèles de traduction sur des fragments identiques. Ne pas lancer toutes les combinaisons STT × LLM × TTS.

Un pilote utilise 12 extraits de 5–15 s, trois répétitions par candidat, ordre aléatoire, une passe à froid et deux avec connexions chaudes. Conserver des résultats par extrait ; le p95 du pilote reste exploratoire. Réduire les candidats avant d'étendre le corpus.

### 2. Comparer les architectures complètes

| Bras | Chaîne | Question |
| --- | --- | --- |
| A | `gpt-realtime-translate`, audio → audio | Référence native conçue pour l'interprétation continue. |
| B | Meilleur STT → meilleur LLM rapide → Eleven Flash | Performance de la chaîne modulaire avec la voix disponible. |
| C | Même STT et LLM que B → Cartesia Sonic 3.6 | Effet du seul moteur vocal. |
| D | Deuxième meilleur STT → mêmes LLM et TTS que le meilleur B/C | Effet du seul transcripteur ; inclure OpenAI si son pilote est compétitif. |
| E, complément | Soniox transcription + traduction → meilleur TTS | Effet d'une traduction intégrée, sous réserve d'accès. |

Les bras B et C sont d'abord évalués avec la même stratégie de validation. Ajuster simultanément moteur et taille des fragments empêcherait d'attribuer les gains.

### 3. Tester l'anticipation sur la meilleure chaîne modulaire

- Contrôle : validation par règle locale de stabilité, sans Jev et sans appel de décision.
- Variante Jev : même flux et mêmes candidats, décision « prêt à prononcer / attendre ».
- Variante OpenAI : même décision avec `gpt-4.1-nano`, puis `gpt-5.4-nano` si compétitif.
- Variante Predicted Outputs : même génération et mêmes fragments, seul `prediction` change.
- Préparation audio anticipée : générer sans lire ; annuler si le texte source ou traduit change. Comptabiliser tout audio et toute traduction abandonnés dans le coût.

Une traduction mot à mot indépendante n'est pas le contrôle principal. La négation, les accords et l'ordre des mots nécessitent souvent du contexte. Le texte affiché peut être révisé ; un mot déjà prononcé ne peut pas être retiré.

### 4. Confirmer les finalistes avec Kevin

Écoute A/B anonymisée et ordre aléatoire, une seule sortie à la fois. Premier couple FR → EN et EN → FR, puis FR → ES et une paire avec réorganisation plus forte, par exemple DE → EN ou FR → JA. Tester uniquement les intersections de langues réellement prises en charge et afficher les exclusions.

Le corpus de confirmation doit comprendre au moins 50 énoncés par paire, des voix humaines, des accents, des nombres, des noms propres, des négations, des hésitations, une correction en fin de phrase et un passage continu d'au moins 60 s. Trois répétitions par finaliste ; résultats par paire et non une seule moyenne.

## Mesures et règles d'équité

- **Premier audio utile audible** : délai entre le début de parole source annoté et le premier contenu traduit correct réellement planifié en lecture. Mesurer séparément premier octet reçu, première trame non silencieuse et lecture navigateur ; le CLI seul ne mesure pas le son entendu.
- **Retard en régime continu** : décalage des unités de sens alignées dans l'entrée et la sortie. Ne pas assimiler une émission rapide de « Hello » à une bonne interprétation du reste.
- **Retard final** : temps entre la fin source et la fin de lecture traduite, avec la vitesse de parole de sortie indiquée.
- **Transcription** : partiel initial, partiel stable, final ; WER sur référence, révisions et omissions. Sans timestamps du fournisseur, utiliser l'annotation commune et ne pas inventer de latence par mot.
- **Traduction** : conservation du sens, noms/nombres/négation, omissions, hallucinations et corrections déjà prononcées. Évaluation bilingue des finalistes ; pas seulement un juge LLM.
- **Expérience** : durée de silence avant réponse, coupures audio, file d'attente accumulée, interruptions, erreurs et reconnexions.
- **Coût** : par minute source, tous appels, prédictions rejetées et audio spéculatif abandonné inclus.
- **Fiabilité** : taux d'échec et délais dépassés reportés dans le tableau. Ne pas exclure les essais ratés pour embellir les percentiles.
- Utiliser une horloge monotone commune au runner ; ne jamais soustraire sans synchronisation les timestamps muraux de deux serveurs. Distinguer position dans l'audio et heure de réception.
- Diffuser les fichiers au rythme réel, conserver les silences, des trames numérotées et la même entrée. Envoyer un fichier d'un bloc ne simule pas un microphone.
- Comparer les trames 20/40/80/100 ms seulement dans les intervalles documentés pour chaque fournisseur. Noter les paramètres, voix, modèles, versions, région, réseau, navigateur et tailles des tampons.
- Comparer un réglage de qualité comparable et le réglage de latence minimal ; ne pas comparer un partiel agressif à un final conservateur comme s'ils garantissaient la même qualité.
- Une passe locale à Paris aide à diagnostiquer ; la décision finale se fait sur l'app hébergée et sa lecture navigateur.

Les seuils initiaux de présélection proposés sont : aucune inversion de négation ni modification de nombre sur les cas ciblés, moins de 1 % d'échecs sur le corpus de confirmation, et aucune croissance durable de la file de lecture pendant le passage continu. Les résultats restent visibles même si aucun bras ne passe ces seuils. Aucun seuil de latence universel n'est promis avant les mesures.

## App de laboratoire puis déploiement

Interface française : source/cible, micro ou extrait, deux bras A/B, source et traduction en direct, lecture séparée, chrono réel et export JSON/CSV des mesures. Afficher « mesuré », « annoncé » et « non testé » distinctement. Conserver les moteurs remplaçables.

Next.js server-side gère les jetons éphémères, les clés, AI Gateway et le stockage des résultats sans secrets. Le navigateur fait uniquement capture, transport, affichage et lecture. Si une orchestration WebSocket persistante est nécessaire, l'héberger sur un worker Node près des fournisseurs plutôt que supposer une connexion entrante persistante dans une route Vercel. Tester la région parisienne contre la région du fournisseur ; garder le trajet le plus rapide mesuré.

Ne déployer l'app de comparaison qu'après le choix du protocole, la connexion de Cartesia et un premier aller-retour audio validé. Le produit final pourra conserver le mode A/B pour les comparaisons suivantes.

## Sources primaires consultées

- [OpenAI : traduction Realtime](https://developers.openai.com/api/docs/guides/realtime-translation)
- [OpenAI : transcription Realtime](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [OpenAI : Predicted Outputs](https://developers.openai.com/api/docs/guides/predicted-outputs)
- [OpenAI : GPT-4.1 nano](https://developers.openai.com/api/docs/models/gpt-4.1-nano)
- [OpenAI : GPT-5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano)
- [OpenAI : modèles TTS et avis de migration](https://developers.openai.com/api/docs/guides/text-to-speech)
- [AI Gateway : évaluation et décisions](https://vercel.com/docs/ai-gateway/modalities/decision)
- [Catalogue AI Gateway vérifié](https://ai-gateway.vercel.sh/v1/models)
- [Gladia : Solaria](https://www.gladia.io/solaria)
- [Gladia : initialisation de session](https://docs.gladia.io/api-reference/v2/live/init)
- [ElevenLabs : modèles et latences annoncées](https://elevenlabs.io/docs/overview/models)
- [ElevenLabs : tampon initial, commits et partiels](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies)
- [Speechmatics : partiels et finals](https://docs.speechmatics.com/speech-to-text/realtime/quickstart)
- [Deepgram : Flux Multilingual](https://developers.deepgram.com/docs/flux/quickstart)
- [Cartesia : Sonic 3.6](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest)
- [Cartesia : Ink 2](https://docs.cartesia.ai/build-with-cartesia/stt/latest)
- [Cartesia : streaming TTS](https://docs.cartesia.ai/get-started/realtime-text-to-speech-quickstart)
- [Soniox : traduction texte continue](https://soniox.com/docs/translation/stt-translation/rt-translation)
