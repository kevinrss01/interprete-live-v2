# Vérifications de l’app — 24 octobre 2026

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
