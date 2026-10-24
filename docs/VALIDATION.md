# Vérifications de l’app — 23 octobre 2026

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
