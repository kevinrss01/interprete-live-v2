# Traduire un appel sur Mac

Le mode **Réunion en ligne** complète le mode conversation existant. Il traduit ce que disent vos interlocuteurs (sous-titres ou voix, à partir du son de l’application d’appel, avec votre accord) et, si vous le souhaitez, votre microphone vers l’appel : en voix traduite, en sous-titres incrustés dans votre vidéo, ou les deux. Portez un casque pour éviter que les voix des autres participants ou leur traduction ne rentrent acoustiquement dans votre micro.

## Activer en un clic

```sh
pnpm dev
```

Ouvrez **Réunion en ligne › Votre voix**, cochez **Ma voix traduite** et/ou **Sous-titres sur ma vidéo**, choisissez les deux langues puis **Activer la traduction**. L’app demande l’autorisation du micro si nécessaire, retrouve le microphone physique enregistré (ou détecte une entrée physique disponible) et, pour la voix traduite, prépare le micro virtuel **Interprete**. Aucun audio n’est capturé au simple lancement de l’app.

Les langues, le microphone physique, la sortie virtuelle, le mode test et l’option de bascule système sont mémorisés sur ce Mac. Les réglages supplémentaires restent dans **Réglages du micro et mode test**.

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

- **Benchmark → Other checks → Show stop control** affiche un aperçu de l’overlay sans ouvrir de micro ni contacter un fournisseur. Le carré ferme l’aperçu.
- Dans **Réglages du micro et mode test**, **Tester au casque** permet de tester votre voix avec le bouton principal. Portez un casque.
- **Benchmark → Other checks → Test outgoing audio** utilise un fichier synthétique français ou anglais avec les vrais fournisseurs. Il ne contribue pas au clonage et ne bascule jamais le micro système.
- **Benchmark → Other checks → Show call prompt** teste la détection et le toast. Avec une configuration déjà valide, l’accord peut démarrer une vraie capture ; **Terminer la simulation** arrête la session associée.

Le bouton **Activer** ou l’accord dans le toast ouvre la capture ; la détection seule ne le fait pas. Les sessions appel ne collectent pas d’échantillons de clonage.

Une pastille ovale séparée de la fenêtre principale affiche l’état et les langues pendant la traduction. Comme les sous-titres, c’est un panneau macOS non activant, visible par-dessus les autres apps, y compris un navigateur ou une réunion en plein écran. Son carré arrête la session active sans activer Interprète. Dans un navigateur, la pastille reste dans la page ; la création du micro, sa bascule et l’overlay au-dessus des autres applications nécessitent l’app macOS.

## Sous-titres et voix traduite de vos interlocuteurs

Le toast d’appel propose quatre cases, mémorisées d’un appel à l’autre :

- **Sous-titres** (cochée par défaut) : ce que disent vos interlocuteurs, traduit dans votre langue, s’affiche en direct dans une fenêtre transparente en bas de l’écran, au-dessus des barres d’outils de Meet, Zoom ou Teams. Glissez la fenêtre pour la déplacer. Elle apparaît sur tous les bureaux et par-dessus une app en plein écran (panneau macOS non activant), puis s’efface après quelques secondes de silence ; lorsqu’elle est effacée, les clics passent à l’application dessous.
- **Voix traduite** : leur traduction remplace leur voix sur la sortie actuelle du Mac. Jev choisit, une fois par session, une voix ElevenLabs proche de la leur (hauteur, étendue et timbre mesurés sur l’appareil ; seuls ces trois nombres sont envoyés). Pour une traduction en français, il choisit parmi des voix de la Voice Library enregistrées par des locuteurs natifs ; les voix prédéfinies, anglaises, garderaient un accent anglais. Les autres langues utilisent encore les voix prédéfinies. Si Jev ne répond pas assez vite, la voix la plus proche en hauteur est utilisée. Aucun clonage : leur voix n’est ni enregistrée ni utilisée comme échantillon. Portez un casque, sinon votre micro renverra cette voix à vos interlocuteurs.
- **Ma voix traduite** (*My translated voice*) : la traduction de votre micro décrite plus haut. Elle est cochée par défaut si un microphone d’appel a déjà été configuré.
- **Sous-titres sur ma vidéo** (*Captions on my video*) : la traduction de ce que vous dites, incrustée dans votre caméra (voir plus bas). Décochée par défaut.

Les cases peuvent être combinées. Les deux premières et un bouton **Traduire leur voix** se trouvent dans **Réunion en ligne › Leur voix**, les deux dernières dans **Votre voix**, sans attendre la détection. La pastille arrête toutes les traductions de l’appel.

Les nouveaux fragments apparaissent progressivement, sans carré ni surlignage de mot. Les derniers mots restent visibles quand le texte déborde. Les animations respectent « Réduire les animations ».

### Capture du son

Sur macOS 14.2+, un « process tap » CoreAudio capte uniquement le son de l’application d’appel détectée (Zoom, Teams, Slack, Discord, FaceTime ou le navigateur de Meet, y compris ses processus auxiliaires). Avec les seuls sous-titres, le son reste audible normalement. Avec **Voix traduite**, le tap coupe le son des apps captées sur ce Mac tant qu’il est lu (`CATapMutedWhenTapped`) : seule la traduction est entendue, et le son revient dès l’arrêt de la capture. Pour Safari, une simulation ou un démarrage manuel sans appel reconnu, tout le son du Mac est capté, sauf celui d’Interprète : la voix traduite, lue nativement par l’app, n’est jamais retranscrite. Avec la voix traduite, toutes les autres apps sont alors coupées pendant la session. Un navigateur capté entièrement inclut aussi ses autres onglets.

À la première capture, macOS demande l’autorisation d’enregistrer l’audio du système (Réglages Système › Confidentialité et sécurité › Enregistrement de l’écran et de l’audio système). Sans autorisation, le son reçu est silencieux : l’app le signale après 12 secondes sans aucun son, et signale aussi une capture interrompue.

Le son capté suit la chaîne existante : trames PCM de 20 ms à 24 kHz, transcription OpenAI Realtime dans la langue de votre interlocuteur, découpage en fragments, feu vert de Jev, traduction en streaming. Pour les sous-titres seuls, `/api/interpret` reçoit `speak: false` : aucun appel ElevenLabs, le texte validé s’affiche dès qu’il arrive. La fin de l’appel détecté arrête aussi cette traduction.

### Tester sans appel

Les outils de test sont regroupés dans **Benchmark**. Voir le [protocole et les limites de mesure](BENCHMARK.md).

- Dans **Benchmark** (barre latérale), **Start the recording test** lance le test principal, avec une explication de son entrée et de sa sortie. Si **They speak** est réglé sur **English**, un extrait NASA anglais de 22,723 secondes remplace la capture système et alimente la vraie traduction entrante. Réglez **You speak** sur **Français** pour tester anglais → français. Les sous-titres flottants sont toujours activés pour ce test ; aucun micro n’est ouvert.
- Pour l’anglais, **Choose a recording** propose **One voice · 23 seconds** et **Three voices · 24 seconds**. Le second extrait est un échange continu entre Suni Williams, Houston et Bill Nelson. Arrêtez le test avant de changer d’extrait. Il permet de tester les changements de voix dans un flux commun ; il n’ajoute ni identification automatique des personnes, ni étiquettes par locuteur, ni trois voix de synthèse distinctes.
- **Play the original English audio** choisit si le son source sera audible. Ce réglage est figé pendant le test pour garder une configuration comparable. Le son source est coupé par défaut. **Also read the French translation aloud** ajoute la voix traduite ; ce choix est indépendant de la préférence **Translated voice** de l’appel. Laissez les deux options audio décochées pour une vérification silencieuse. La traduction nécessite internet et utilise les fournisseurs payants. Utilisez un casque pour comparer parole et sous-titres. L’exemple français reste synthétique ; ces exemples ne servent jamais au clonage. Source et reproduction : [samples/README.md](../apps/desktop/public/samples/README.md).
- **Other checks**, replié par défaut, sépare quatre outils avec une explication par action : aperçu local des sous-titres (**Show text preview**, sans audio ni fournisseur), traduction sortante synthétique (**Test outgoing audio**), aperçu de la pastille (**Show stop control**) et simulation du toast (**Show call prompt**). Accepter ce dernier peut démarrer une vraie capture selon les options sélectionnées.
- `pnpm test:system-audio` vérifie sur ce Mac que le tap système livre des trames de 20 ms pendant une seconde. Il ne conserve ni n’envoie le son, et peut déclencher la demande d’autorisation.

## Personnaliser les sous-titres flottants

**Settings → Floating captions** permet de modifier la barre et d’enregistrer ses préférences sur ce Mac :

- **Show captions** affiche la vraie fenêtre Tauri avec un texte fictif, sans miniature intégrée aux réglages. Changez les réglages pour voir le résultat en direct, puis utilisez **Hide captions**. Quitter cet onglet ferme également l’aperçu. Ce contrôle est disponible dans l’app macOS, à l’arrêt des traductions.
- Neuf positions prédéfinies accessibles au clavier, ou glisser-déposer directement sur la fenêtre affichée sur le bureau, en aperçu comme pendant un appel. Sa position est enregistrée après déplacement.
- Trois tailles (**Small**, **Medium**, **Large**) qui modifient la largeur et la taille du texte.
- Thèmes **Dark**, **Light** et **Transparent**, opacité du fond et couleur du texte. Les préréglages associent des couleurs contrastées.
- **Restore defaults** rétablit le thème sombre, la taille moyenne et la position en bas au centre.

L’aperçu ne démarre aucune capture, aucun son ni aucun fournisseur. Son texte reste visible jusqu’à sa fermeture. Les réglages s’appliquent aux sous-titres, y compris pendant une session active. La position est relative à la zone de travail de l’écran choisi par déplacement, avec une marge pour garder la barre visible et dégager la barre d’outils de l’appel. Le nom de l’écran est mémorisé localement ; si cet écran est débranché, l’app utilise celui de la fenêtre principale. La fenêtre de sous-titres reçoit les clics lorsqu’elle est visible pour permettre son déplacement, sans prendre le focus clavier de l’appel. La pastille d’arrêt conserve son apparence et son emplacement.

## Sous-titres sur votre vidéo

La case **Sous-titres sur ma vidéo** incruste la traduction de ce que vous dites dans l’image de votre caméra, en bas, comme des sous-titres de film : vos interlocuteurs la lisent directement dans Meet, Zoom ou Teams. Elle fonctionne seule ou avec **Ma voix traduite** :

- seule, votre vraie voix part dans l’appel, sans bascule du micro système, et Interprète traduit en texte uniquement : `/api/interpret` reçoit `speak: false`, sans synthèse ElevenLabs ;
- combinée, vos interlocuteurs entendent la voix traduite et lisent le même texte sur votre vidéo.

### Fonctionnement

Interprète ouvre votre caméra physique (AVFoundation), adapte chaque image au format 1920 × 1080 sans la déformer, dessine les deux dernières lignes de la traduction (fond sombre translucide, texte blanc, fondu à l’apparition et à l’effacement), puis envoie l’image composée, 30 fois par seconde, à **OBS Virtual Camera**. Dans l’application d’appel, choisissez **OBS Virtual Camera** comme caméra.

Les mots s’ajoutent en fin de ligne et les passages anciens sortent en entier : les lignes affichées ne se recomposent pas à chaque mot. Après 5 secondes sans nouveau mot, le sous-titre s’efface ; les mots suivants repartent d’un sous-titre vide.

Meet et Zoom affichent votre propre aperçu en miroir : le texte peut vous sembler inversé, mais vos interlocuteurs le lisent à l’endroit. L’aperçu de **Caméra et aperçu vidéo** (*Camera and video preview*) montre l’image telle qu’ils la reçoivent.

### Pourquoi OBS Virtual Camera

Depuis macOS 14.1, l’ancien format de plug-in de caméra (DAL) n’est plus chargé : une caméra virtuelle doit être une extension système CoreMediaIO. Son installation exige l’autorisation Apple `com.apple.developer.system-extension.install`, réservée aux comptes Apple Developer Program payants, avec une app signée et notarisée. Une caméra au nom d’Interprète demande donc ce compte. OBS Studio, gratuit, fournit une extension de caméra signée et notarisée qui accepte les images d’une autre application : Interprète l’alimente directement, à la place d’OBS.

Installation, une seule fois :

```sh
brew install --cask obs
```

Ouvrez OBS, cliquez sur **Démarrer la caméra virtuelle**, puis autorisez son extension dans Réglages Système › Général › Ouverture et extensions. OBS peut ensuite rester fermé. **Caméra et aperçu vidéo** indique si OBS est installé et si sa caméra virtuelle est prête ; l’état se met à jour au retour dans l’app.

### Autorisation et cycle de vie

macOS demande l’accès à la caméra pour Interprète à la première utilisation. Le choix de la caméra est mémorisé sur ce Mac.

La vidéo démarre avec **Activer la traduction** quand la case est cochée, avec l’accord du toast, ou avec **Prévisualiser la vidéo** (*Preview video*). Quand la traduction s’arrête (bouton, pastille, Échap), la vidéo continue sans sous-titres : vos interlocuteurs gardent votre image. **Arrêter la vidéo** (*Stop video*), la fin de l’appel détecté, la sortie du mode Réunion en ligne, un rechargement de la fenêtre principale ou la fermeture de l’app libèrent la caméra ; OBS Virtual Camera affiche alors son image d’attente. Une caméra débranchée ou sans image pendant 5 secondes, ou une caméra virtuelle qui ne prend plus les images pendant 5 secondes (extension désactivée), arrête la vidéo avec un message ; une traduction en sous-titres seuls s’arrête alors aussi. Quitter le mode appel pendant la demande d’autorisation macOS annule l’ouverture de la caméra.

### Tester

- Dans **Benchmark → Camera and video preview**, **Test the captions**, vidéo démarrée, fait défiler deux phrases d’exemple sur votre vidéo avec le rythme et l’effacement réels, sans capture ni fournisseur.
- **Test outgoing audio** (dans **Benchmark → Other checks**), vidéo démarrée, incruste la vraie traduction de l’exemple synthétique.
- Les versions de développement proposent une mire de test à la place d’une caméra.
- `pnpm test:virtual-camera` envoie cette mire sous-titrée à OBS Virtual Camera pendant deux secondes et vérifie que l’extension prend les images. Il n’ouvre aucune caméra. Exécutez-le hors réunion : une application qui affiche cette caméra verrait la mire. Les tests ordinaires composent les images sans jamais les envoyer à la caméra virtuelle.

### Limites

- Une seule caméra à la fois ; elle reste allumée tant que la vidéo tourne.
- Pour qu’Interprète ne prolonge pas lui-même l’appel, la détection ignore la caméra qu’il filme et OBS Virtual Camera tant qu’il l’alimente. Pendant un appel avec sous-titres vidéo, la détection repose donc sur le micro de l’application d’appel. Dans une salle d’attente micro coupé, l’appel peut être considéré comme terminé huit secondes après l’accord, ce qui arrête la vidéo : activez le micro avant d’accepter, ou démarrez la vidéo depuis Interprète une fois dans l’appel.
- Une caméra au nom d’Interprète reprendrait la même chaîne d’images sous la forme d’une extension système, avec un compte Apple Developer payant. Une extension Chrome pourrait aussi fournir une caméra aux appels dans le navigateur.

## Détection et accord

Sur macOS 14.2+, CoreAudio indique quels processus utilisent une entrée audio, et CoreMediaIO si une caméra est allumée. Une application d’appel compte comme active quand elle utilise le micro, ou quand elle est au premier plan pendant qu’une caméra filme : la salle d’attente de Meet ou l’aperçu de Zoom déclenchent ainsi le toast avant de rejoindre l’appel, même micro coupé. CoreMediaIO ne dit pas quelle app filme : une app qui tient le micro reste donc prioritaire. Deux observations successives, espacées d’une seconde, déclenchent le toast. Zoom, Teams, FaceTime, Slack, Discord, Webex, Skype, GoTo Meeting, WhatsApp, Telegram, Signal, Messenger et les navigateurs Chrome, Edge, Firefox, Arc, Dia, Brave, Opera, Vivaldi et Chromium sont reconnus. Safari peut apparaître sous un processus WebKit générique : ce processus est volontairement exclu car il est aussi utilisé par Interprète. Dans ce cas, démarrez la traduction manuellement. L’app doit rester ouverte.

Ce signal indique une **activité micro ou caméra**, pas l’état serveur d’une réunion. Un enregistrement, une page utilisant la caméra dans un navigateur, ou une autre app qui filme pendant qu’une app d’appel est au premier plan, peut aussi déclencher le toast. Une salle d’attente sans caméra ni micro, ou un appel totalement muet sans caméra, peut ne pas être détecté. L’app ne lit ni les URL, ni les titres des onglets, ni le calendrier, et la détection n’ouvre aucune image de la caméra. Elle ne demande aucun accès Accessibilité, Caméra ou Enregistrement de l’écran ; seule l’option **Sous-titres sur ma vidéo** ouvre la caméra, après autorisation.

Le toast est un panneau macOS non activant : il glisse depuis le bord droit de l’écran où se trouve le pointeur (simple fondu si « Réduire les animations » est activé), s’affiche au-dessus de toutes les apps, sur tous les bureaux et par-dessus Meet ou Zoom en plein écran, sans prendre le focus clavier de l’appel. Un clic sur ses cases ou ses boutons fonctionne directement.

**Ignorer** supprime le toast pour cette activité, sans nouvelle demande chaque seconde. Huit secondes sans activité dans l’application terminent la détection et arrêtent la traduction associée : ni micro, ni caméra avec l’app au premier plan. Couper le micro pendant une durée prolongée, l’app d’appel en arrière-plan, peut donc arrêter la traduction ; il faut la relancer explicitement. Désactiver la détection ou quitter le mode appel arrête également la session. Les erreurs de capture ou de sortie sont affichées ; aucune sortie vers les haut-parleurs ne remplace silencieusement le micro virtuel.

Les sessions appel n’ajoutent pas d’échantillons de clonage. Les voix déjà configurées restent disponibles via les profils existants.

## Latence

La capture conserve les trames PCM mono de 20 ms à 24 kHz de l’architecture existante. La transcription et la capture démarrent en parallèle. Les traductions validées sont synthétisées et les paquets PCM écrits immédiatement dans une file native CoreAudio. Le rééchantillonnage est continu, et la sortie ne dépend pas de `AudioContext.setSinkId`, absent de certaines WebViews. Les callbacks audio utilisent une file sans verrou. Pour le micro de l’app, le flux utilise directement le pilote sous-jacent et conserve sa période matérielle : imposer une nouvelle période à un agrégat déjà utilisé peut bloquer CoreAudio.

La transcription, la validation linguistique, le réseau et la synthèse restent les principales sources de délai. Le système ne peut pas promettre une traduction sans délai ; il ne doit pas prononcer une traduction spéculative incorrecte. Les silences ajoutés par la synthèse autour de chaque fragment sont retirés, et la voix accélère légèrement (jusqu’à 1,2) quand la traduction prend du retard sur la personne. Mesures du 25 octobre avec `gpt-5.4-nano` : environ 1,3 s au P50 entre la fin d’un groupe de mots et le début de sa voix traduite, et ~0,9 s de plancher dû aux fournisseurs ; `gpt-5.4-mini` ajoute environ 0,15 s (voir [VALIDATION.md](VALIDATION.md)). La lecture applique une contre-pression à l’intérieur des longs segments : les paquets attendent que la file matérielle redescende sous environ 5,5 secondes, afin de préparer le segment suivant pendant la lecture du précédent. La capacité native de 8 secondes reste un garde-fou, pas une coupure systématique des phrases longues. Une panne de sortie arrête explicitement la session. Les métriques Web Audio de première lecture ne sont pas présentées comme une mesure du périphérique natif.

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

# Avec OBS Virtual Camera activée : mire sous-titrée vers la caméra virtuelle, sans ouvrir de caméra
pnpm test:virtual-camera

# Vrais fournisseurs, avec un fichier synthétique, sans micro ni haut-parleur :
pnpm exec tsx scripts/verify-live-app.ts apps/desktop/public/samples/fr.wav
```

Le script utilise une session Bearer et une origine locale autorisée (`http://localhost:1420`). Si votre serveur utilise d’autres origines, définissez `APP_TEST_ORIGIN` ; `APP_TEST_URL` change l’URL de l’API.

Le 24 octobre 2026, un échantillon synthétique français de 4,23 s a renvoyé son premier texte à 1,72 s et son premier signal vocal planifié à 2,75 s (3,85 s lors d’une seconde exécution), pendant que l’entrée était encore ouverte. Cette observation ne mesure pas la latence acoustique de BlackHole et ne constitue pas un benchmark représentatif.

Les tests unitaires vérifient la temporisation/déduplication de détection, l’exclusion de l’app elle-même, le rééchantillonnage indépendant des paquets, les octets PCM impairs, les annulations concurrentes, la fin de file native et les erreurs de périphérique. Le test matériel `pnpm test:virtual-mic`, ignoré dans la suite unitaire normale, a été validé historiquement avec BlackHole 2ch 0.7.1 et cible maintenant le micro nommé comme l’app. Exécutez ce test de signal hors réunion : une application recevant ce micro peut entendre son signal synthétique. Il écrit un signal synthétique de 997 Hz dans la sortie native et vérifie sa présence sur l’entrée BlackHole ; il échoue explicitement si le pilote est absent. Il n’utilise ni les fournisseurs réseau, ni votre micro physique, ni les haut-parleurs.

Une validation complète du micro virtuel demande BlackHole installé et une application réceptrice sélectionnant son entrée. Une traduction affichée à l’écran ne prouve pas que Meet / Zoom utilise le bon microphone.
