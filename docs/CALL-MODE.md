# Traduire votre microphone dans un appel sur Mac

Le mode **Réunion en ligne** complète le mode conversation existant. Votre microphone est traduit ; l’app n’intercepte pas la sortie audio de l’appel. Portez un casque pour éviter que les voix des autres participants ne rentrent acoustiquement dans votre micro.

## Démarrer et tester sans appel

```sh
pnpm dev
```

1. Sur l’accueil, choisissez **Réunion en ligne**.
2. Choisissez votre langue et celle que votre interlocuteur doit entendre.
3. Dans **Son**, sélectionnez **Tester au casque** et portez un casque.
4. Ouvrez **Essayer sans appel**, puis cliquez sur **Traduire l’exemple audio**. Le fichier synthétique français ou anglais traverse les vrais services de transcription, traduction et synthèse. Aucune capture du micro n’est nécessaire pour cet exemple. Les clés serveur doivent être configurées et ces appels utilisent les fournisseurs payants existants.
5. Pour tester votre propre voix, cliquez sur **Autoriser le micro**, choisissez votre microphone physique, puis **Démarrer le test au casque**. Les transcriptions et traductions s’affichent pendant la parole. **Arrêter la traduction** ou Échap ferme le micro et arrête le son.
6. **Simuler un appel** affiche le vrai toast en haut à droite de l’écran dans l’app Tauri. **Ignorer** ne capture aucun son. **Traduire l’appel** ouvre le mode appel. Avec des périphériques valides déjà sélectionnés, la traduction vers le micro virtuel commence ; sinon, les réglages permettent de terminer la configuration. **Terminer la simulation** ferme le test et arrête la traduction associée.

Une petite pastille ovale apparaît à droite de l’écran pendant la connexion, l’écoute et la restitution de la traduction, en mode appel comme en conversation. Elle affiche l’état et les langues ; le bouton carré arrête la session active, ferme le microphone et interrompt la sortie audio. La pastille reste séparée de la fenêtre principale dans l’app macOS. Elle disparaît à l’arrêt ou à la fin de la traduction.

**Tester la pastille** affiche un aperçu, sans microphone ni appel aux fournisseurs. Cliquez sur le carré pour le fermer. Dans le navigateur, l’aperçu reste dans la page ; utilisez l’app Tauri pour l’affichage au-dessus des autres applications.

Dans un navigateur, l’écoute locale et l’aperçu de simulation restent disponibles. La détection système, le toast hors fenêtre et la sortie virtuelle nécessitent l’app macOS.

## Utiliser la traduction dans Meet / Zoom / Teams

Installez le pilote audio virtuel gratuit [BlackHole 2ch](https://github.com/ExistentialAudio/BlackHole), si nécessaire :

```sh
brew install blackhole-2ch
```

L’installation du pilote peut demander les droits administrateur et un redémarrage. Redémarrez Interprète et l’application d’appel après installation. Le programme n’installe pas de pilote et ne redémarre jamais CoreAudio automatiquement.

Dans Interprète :

- **Microphone** : votre micro intégré, USB ou votre casque. Les alias système sont exclus. CoreAudio fournit la liste des entrées physiques : les transports virtuels et agrégés sont exclus, même lorsque leur nom a été personnalisé.
- **Son** : **Envoyer dans l’appel**.
- **Sortie vers l’appel** : **BlackHole 2ch**.

Dans Meet / Zoom / Teams :

- **Microphone** : **BlackHole 2ch**.
- **Haut-parleur** : votre casque habituel.

La sortie système du Mac reste sur le casque ou les haut-parleurs habituels. Interprète écrit uniquement la parole synthétique dans BlackHole ; il ne mélange pas le microphone original avec la traduction. Choisir le micro physique dans l’application d’appel contournerait la traduction. Aucun programme ne peut modifier de façon fiable le périphérique choisi dans toutes les applications : cette sélection initiale est manuelle.

Vous pouvez lancer la traduction manuellement, même si la détection automatique ne reconnaît pas votre application ou si le microphone de l’appel est coupé.

## Détection et accord

Sur macOS 14.2+, CoreAudio indique quels processus utilisent une entrée audio. Deux observations successives, espacées d’une seconde, déclenchent le toast. Zoom, Teams, FaceTime, Slack, Discord et les navigateurs Chrome, Edge, Firefox, Arc, Dia et Brave sont reconnus. Safari peut apparaître sous un processus WebKit générique : ce processus est volontairement exclu car il est aussi utilisé par Interprète. Dans ce cas, démarrez la traduction manuellement. L’app doit rester ouverte.

Ce signal indique une **activité microphone**, pas l’état serveur d’une réunion. Une salle de préparation ou un enregistrement dans un navigateur peut aussi déclencher le toast. Un appel totalement muet peut ne pas être détecté. L’app ne lit ni les URL, ni les titres des onglets, ni le calendrier. Aucun accès Accessibilité ou Enregistrement de l’écran n’est nécessaire.

**Ignorer** supprime le toast pour cette activité, sans nouvelle demande chaque seconde. Huit secondes sans activité dans l’application terminent la détection et arrêtent la traduction associée. Couper le micro pendant une durée prolongée peut donc arrêter la traduction ; il faut la relancer explicitement. Désactiver la détection ou quitter le mode appel arrête également la session. Les erreurs de capture ou de sortie sont affichées ; aucune sortie vers les haut-parleurs ne remplace silencieusement le micro virtuel.

Les sessions appel n’ajoutent pas d’échantillons de clonage. Les voix déjà configurées restent disponibles via les profils existants.

## Latence

La capture conserve les trames PCM mono de 20 ms à 24 kHz de l’architecture existante. La transcription et la capture démarrent en parallèle. Les traductions validées sont synthétisées et les paquets PCM écrits immédiatement dans une file native CoreAudio. Le rééchantillonnage est continu, et la sortie ne dépend pas de `AudioContext.setSinkId`, absent de certaines WebViews. Les callbacks audio utilisent une file sans verrou. Le tampon demandé au périphérique est de 128 trames lorsque le pilote le permet.

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

Les tests unitaires vérifient la temporisation/déduplication de détection, l’exclusion de l’app elle-même, le rééchantillonnage indépendant des paquets, les octets PCM impairs, les annulations concurrentes, la fin de file native et les erreurs de périphérique. Le test matériel `pnpm test:virtual-mic`, ignoré dans la suite unitaire normale, a été validé sur le Mac avec BlackHole 2ch 0.7.1. Il écrit un signal synthétique de 997 Hz dans la sortie native et vérifie sa présence sur l’entrée BlackHole ; il échoue explicitement si le pilote est absent. Il n’utilise ni les fournisseurs réseau, ni votre micro physique, ni les haut-parleurs.

Une validation complète du micro virtuel demande BlackHole installé et une application réceptrice sélectionnant son entrée. Une traduction affichée à l’écran ne prouve pas que Meet / Zoom utilise le bon microphone.
