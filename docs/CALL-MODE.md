# Traduire votre microphone dans un appel sur Mac

Le mode **Appels sur Mac** complète le mode conversation existant. Votre microphone est traduit ; l’app n’intercepte pas la sortie audio de l’appel. Portez un casque pour éviter que les voix des autres participants ne rentrent acoustiquement dans votre micro.

## Activer en un clic

```sh
pnpm dev
```

Ouvrez **Appels sur Mac**, choisissez les deux langues puis **Activer la traduction**. L’app demande l’autorisation du micro si nécessaire, retrouve le microphone physique enregistré (ou détecte une entrée physique disponible) et prépare le micro virtuel **Interprete**. Aucun audio n’est capturé au simple lancement de l’app.

Les langues, le microphone physique, le mode appel/conversation, la sortie virtuelle, le mode test et l’option de bascule système sont mémorisés sur ce Mac. Les réglages supplémentaires restent dans **Réglages du micro et mode test**.

**Utiliser le micro de l’app comme micro système** est activé par défaut. La bascule a lieu seulement après le démarrage réussi de la capture et de la transcription. Dans Meet / Zoom, choisissez une fois **Système / Par défaut** comme microphone pour suivre cette bascule ; une entrée choisie explicitement dans l’application d’appel reste indépendante. Gardez votre casque comme haut-parleur.

**Désactiver la traduction**, le carré de la pastille, la fin de l’appel ou la fermeture normale de l’app arrêtent la sortie et rétablissent le micro précédent. Un choix manuel différent effectué dans macOS pendant la session est conservé. Si le micro précédent a été débranché, l’app tente une entrée physique disponible, en privilégiant le micro intégré. Si la restauration échoue, son état est conservé pour être réessayé au prochain lancement. Après un arrêt forcé ou un crash, cette récupération a lieu au prochain lancement, pas pendant que l’app est fermée. Le journal local ne contient que les identifiants de périphériques et de session nécessaires à la restauration, jamais de son.

Pour conserver manuellement le choix du micro système, désactivez l’option de bascule. Vous pouvez alors sélectionner **Interprete** directement dans Meet / Zoom.

## Micro au nom de l’app

Le nom vient de `productName` dans la configuration Tauri : **Interprete**. L’app crée un périphérique agrégé public persistant, identifié par son propre UID et contenant uniquement BlackHole 2ch. Le flux synthétique est injecté directement dans le pilote de boucle ; l’entrée agrégée l’expose au système et aux applications sous le nom de l’app. Aucun microphone physique ni son du système n’est mélangé dans ce périphérique.

Le pilote gratuit [BlackHole 2ch](https://github.com/ExistentialAudio/BlackHole) reste nécessaire :

```sh
brew install blackhole-2ch
```

Après installation du pilote, redémarrez macOS si demandé puis ouvrez Interprète. L’app ne réinstalle pas de pilote, ne redémarre pas CoreAudio et ne modifie ni la sortie audio du système ni son volume. La détection et la sélection du périphérique utilisent son UID ; un homonyme ou une composition contenant des sources inattendues est refusé.

## Tester sans perturber un appel

- **Tester la pastille** affiche un aperçu de l’overlay sans ouvrir de micro ni contacter un fournisseur. Le carré ferme l’aperçu.
- Dans **Réglages du micro et mode test**, **Écoute locale · tester au casque** permet de tester votre voix avec le bouton principal. Portez un casque.
- **Traduire l’exemple audio** utilise un fichier synthétique français ou anglais avec les vrais fournisseurs. Il ne contribue pas au clonage et ne bascule jamais le micro système.
- **Simuler un appel** teste la détection et le toast. Avec une configuration déjà valide, l’accord peut démarrer une vraie capture ; **Terminer la simulation** arrête la session associée.

Le bouton **Activer** ou l’accord dans le toast ouvre la capture ; la détection seule ne le fait pas. Les sessions appel ne collectent pas d’échantillons de clonage.

Une pastille ovale séparée de la fenêtre principale affiche l’état et les langues pendant la traduction. Son carré arrête la session active. Dans un navigateur, la pastille reste dans la page ; la création du micro, sa bascule et l’overlay au-dessus des autres applications nécessitent l’app macOS.

## Détection et accord

Sur macOS 14.2+, CoreAudio indique quels processus utilisent une entrée audio. Deux observations successives, espacées d’une seconde, déclenchent le toast. Zoom, Teams, FaceTime, Slack, Discord et les navigateurs Chrome, Edge, Firefox, Arc, Dia et Brave sont reconnus. Safari peut apparaître sous un processus WebKit générique : ce processus est volontairement exclu car il est aussi utilisé par Interprète. Dans ce cas, démarrez la traduction manuellement. L’app doit rester ouverte.

Ce signal indique une **activité microphone**, pas l’état serveur d’une réunion. Une salle de préparation ou un enregistrement dans un navigateur peut aussi déclencher le toast. Un appel totalement muet peut ne pas être détecté. L’app ne lit ni les URL, ni les titres des onglets, ni le calendrier. Aucun accès Accessibilité ou Enregistrement de l’écran n’est nécessaire.

**Ignorer** supprime le toast pour cette activité, sans nouvelle demande chaque seconde. Huit secondes sans activité dans l’application terminent la détection et arrêtent la traduction associée. Couper le micro pendant une durée prolongée peut donc arrêter la traduction ; il faut la relancer explicitement. Désactiver la détection ou quitter le mode appel arrête également la session. Les erreurs de capture ou de sortie sont affichées ; aucune sortie vers les haut-parleurs ne remplace silencieusement le micro virtuel.

Les sessions appel n’ajoutent pas d’échantillons de clonage. Les voix déjà configurées restent disponibles via les profils existants.

## Latence

La capture conserve les trames PCM mono de 20 ms à 24 kHz de l’architecture existante. La transcription et la capture démarrent en parallèle. Les traductions validées sont synthétisées et les paquets PCM écrits immédiatement dans une file native CoreAudio. Le rééchantillonnage est continu, et la sortie ne dépend pas de `AudioContext.setSinkId`, absent de certaines WebViews. Les callbacks audio utilisent une file sans verrou. Pour le micro de l’app, le flux utilise directement le pilote sous-jacent et conserve sa période matérielle : imposer une nouvelle période à un agrégat déjà utilisé peut bloquer CoreAudio.

La transcription, la validation linguistique, le réseau et la synthèse restent les principales sources de délai. Le système ne peut pas promettre une traduction sans délai ; il ne doit pas prononcer une traduction spéculative incorrecte. La lecture applique une contre-pression à l’intérieur des longs segments : les paquets attendent que la file matérielle redescende sous environ 5,5 secondes, afin de préparer le segment suivant pendant la lecture du précédent. La capacité native de 8 secondes reste un garde-fou, pas une coupure systématique des phrases longues. Une panne de sortie arrête explicitement la session. Les métriques Web Audio de première lecture ne sont pas présentées comme une mesure du périphérique natif.

## Vérifications reproductibles

```sh
pnpm typecheck
pnpm lint
pnpm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
pnpm --filter @interprete/desktop build
pnpm --filter @interprete/desktop tauri build --debug --bundles app

# Avec BlackHole installé : signal synthétique vers la sortie, vérifié sur l’entrée virtuelle
pnpm test:virtual-mic

# Vrais fournisseurs, avec un fichier synthétique, sans micro ni haut-parleur :
pnpm exec tsx scripts/verify-live-app.ts apps/desktop/public/samples/fr.wav
```

Le script utilise une session Bearer et une origine locale autorisée (`http://localhost:1420`). Si votre serveur utilise d’autres origines, définissez `APP_TEST_ORIGIN` ; `APP_TEST_URL` change l’URL de l’API.

Le 24 octobre 2026, un échantillon synthétique français de 4,23 s a renvoyé son premier texte à 1,72 s et son premier signal vocal planifié à 2,75 s (3,85 s lors d’une seconde exécution), pendant que l’entrée était encore ouverte. Cette observation ne mesure pas la latence acoustique de BlackHole et ne constitue pas un benchmark représentatif.

Les tests unitaires vérifient la temporisation/déduplication de détection, l’exclusion de l’app elle-même, le rééchantillonnage indépendant des paquets, les octets PCM impairs, les annulations concurrentes, la fin de file native et les erreurs de périphérique. Le test matériel `pnpm test:virtual-mic`, ignoré dans la suite unitaire normale, a été validé historiquement avec BlackHole 2ch 0.7.1 et cible maintenant le micro nommé comme l’app. Exécutez ce test de signal hors réunion : une application recevant ce micro peut entendre son signal synthétique. Il écrit un signal synthétique de 997 Hz dans la sortie native et vérifie sa présence sur l’entrée BlackHole ; il échoue explicitement si le pilote est absent. Il n’utilise ni les fournisseurs réseau, ni votre micro physique, ni les haut-parleurs.

Une validation complète du micro virtuel demande BlackHole installé et une application réceptrice sélectionnant son entrée. Une traduction affichée à l’écran ne prouve pas que Meet / Zoom utilise le bon microphone.
