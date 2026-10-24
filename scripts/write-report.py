from pathlib import Path
import json,statistics,random,collections
root=Path(__file__).resolve().parent.parent
j=json.loads((root/'benchmark-results/reviewed-snapshot.json').read_text())
def rows(k):return j['queries'][k]['rows']
def num(n):return '—' if n is None else f'{n:,.0f}'.replace(',',' ')
def table(headers,rs):return '| '+' | '.join(headers)+' |\n| '+' | '.join('---' for _ in headers)+' |\n'+'\n'.join('| '+' | '.join(str(v).replace('|','/') for v in r)+' |' for r in rs)+'\n'
tts={r['model']:r for r in rows('tts')};decision={r['model']:r for r in rows('decision')};tr={r['model']:r for r in rows('translation')}
text=f'''# Traduction vocale instantanée : rapport des essais

État des mesures : 23 octobre 2026. Résultats locaux sur 12 enregistrements humains, en français, anglais et espagnol. Ce rapport ne prétend pas désigner le moteur universellement le plus rapide.

## Ce que je retiens

- **Synthèse vocale : Eleven Flash parle plus tôt dans ce test**, malgré un premier paquet plus rapide chez Cartesia. Début de parole simulé médian : {num(tts['eleven-flash']['speechP50'])} ms contre {num(tts['cartesia-sonic']['speechP50'])} ms pour Cartesia. Premier paquet : {num(tts['eleven-flash']['firstP50'])} ms et {num(tts['cartesia-sonic']['firstP50'])} ms respectivement. La métrique utile dépend donc du contenu audio, pas seulement du premier octet.
- **Traduction texte : Gemini 3.5 Flash Lite et GPT-5.4 nano sont proches.** Premier token médian {num(tr['google/gemini-3.5-flash-lite']['firstP50'])} ms et {num(tr['openai/gpt-5.4-nano']['firstP50'])} ms, via AI Gateway. L'écart entre ces médianes ne suffit pas à prouver une supériorité générale.
- **Jev est un décideur rapide, pas un générateur de traduction libre.** {num(decision['typesafe-ai/jev-1.14.0']['latencyP50'])} ms médian pour décider; {decision['typesafe-ai/jev-1.14.0']['correctPct']} % d'accord avec les étiquettes du petit corpus construit. Il valide trop tôt « Le prix est de cent », qui peut se prolonger en « cent vingt-cinq ».
- **La stabilité du texte est déterminante.** Prononcer un résultat provisoire erroné peut produire une traduction incohérente, même si la transcription finale devient correcte. Attendre les énoncés finaux augmente le retard.
- **OpenAI Realtime Translate reste une référence utile**, mais les paquets initiaux silencieux ne sont pas un début de traduction audible. Le tableau des chaînes utilise le signal vocal détecté, pas leur arrivée.

## Transcription

Les émissions sont comparées sur l'intersection des mots correctement reconnus par tous les fournisseurs, avec un alignement automatique de référence. Les mots erronés restent dans la WER et ne sont pas récompensés comme des émissions rapides. La WER est lexicale, sensible aux chiffres versus nombres écrits en lettres. Les échecs de transport sont comptés séparément.

'''
text+=table(['Moteur','OK / essais','Retard mot p50 (ms)','p95 (ms)','WER (%)','Mots communs'],[[r['model'],f"{r['success']} / {r['trials']}",num(r['wordLagP50']),num(r['wordLagP95']),r['werPct'],r['matchedWords']] for r in rows('stt')])
text+='\n## Voix\n\nTrois textes en EN/FR/ES, trois répétitions finales par moteur. PCM 24 kHz, mêmes textes, voix propres à chaque service. La négociation de session OpenAI est incluse.\n\n'
text+=table(['Moteur','OK / essais','Paquet p50 (ms)','Parole p50 (ms)','Parole p95 (ms)'],[[r['model'],f"{r['success']} / {r['trials']}",num(r['firstP50']),num(r['speechP50']),num(r['speechP95'])] for r in rows('tts')])
text+='\nFish Audio : crédit API insuffisant, aucune mesure audio exploitable. Aucun rechargement effectué. OpenAI mini TTS est un ancien modèle, annoncé en arrêt le 6 janvier 2027 ; il est séparé de Realtime 2.1 mini. Les résultats ne constituent pas un classement subjectif de naturel vocal.\n\n## Traduction texte\n\n'
text+=table(['Modèle','OK / essais','Premier token p50 (ms)','p95 (ms)','Texte complet p50 (ms)','Coût observé USD'],[[r['model'],f"{r['success']} / {r['trials']}",num(r['firstP50']),num(r['firstP95']),num(r['totalP50']),f"{r['costUsd']:.5f}"] for r in rows('translation')])
text+='\nLes coûts ci-dessus proviennent des réponses AI Gateway et couvrent uniquement ces essais texte. Ils ne sont pas le coût de la chaîne audio complète.\n\n## Décision : Jev contre OpenAI\n\n12 fragments construits, dont six complets et six incomplets, répétés trois fois. Ce test n’établit pas la calibration des probabilités ni la précision en conversation générale.\n\n'
text+=table(['Modèle','Accord (%)','Décision p50 (ms)','p95 (ms)','Départs prématurés'],[[r['model'],r['correctPct'],num(r['latencyP50']),num(r['latencyP95']),r['premature']] for r in rows('decision')])
text+='\n## Predicted Outputs\n\nMême modèle GPT-4.1 nano, mêmes instructions et paramètres, même API directe OpenAI. La seule différence est la traduction précédente fournie dans `prediction`. 18 paires, six cas distincts; ordre alterné.\n\n'
text+=table(['Condition','Essais','Premier token p50 (ms)','Complet p50 (ms)','p95 (ms)','Jetons acceptés / rejetés'],[[r['variant'],r['trials'],num(r['firstP50']),num(r['totalP50']),num(r['totalP95']),f"{r['acceptedTokens']} / {r['rejectedTokens']}"] for r in rows('prediction')])
raw=[json.loads(l) for l in (root/'benchmark-results/prediction-final.jsonl').read_text().splitlines() if l.strip()]
paired=collections.defaultdict(dict)
for r in raw:
 if r['status']=='ok':paired[(r['caseId'],r['rep'])][r['predicted']]=r['totalMs']
deltas=[v[False]-v[True] for v in paired.values() if False in v and True in v]
caseDeltas=collections.defaultdict(list)
for (case,rep),v in paired.items():
 if False in v and True in v:caseDeltas[case].append(v[False]-v[True])
rng=random.Random(23);means=[statistics.mean(v) for v in caseDeltas.values()];boot=sorted(statistics.mean(rng.choices(means,k=len(means))) for _ in range(5000))
text+=f'\nGain moyen apparié du temps complet (positif = prédiction plus rapide) : **{statistics.mean(deltas):.0f} ms**. Intervalle bootstrap exploratoire à 95 %, rééchantillonné par cas : **{boot[125]:.0f} à {boot[4875]:.0f} ms**. Six cas seulement : cela ne démontre pas un gain général en conversation.\n'
text+='\n## Trajet direct ou AI Gateway\n\nMême GPT-4.1 nano, trois textes, quatre répétitions appariées. Les fournisseurs peuvent utiliser des capacités et routages différents : ce résultat ne mesure pas un simple coût de proxy.\n\n'
text+=table(['Trajet','Essais','Premier token p50 (ms)','p95 (ms)','Complet p50 (ms)'],[[r['route'],r['trials'],num(r['firstP50']),num(r['firstP95']),num(r['totalP50'])] for r in rows('routing')])
text+='\n## Chaînes complètes\n\nMême intersection de six fichiers pour tous les bras. Deux essais par fichier en profil agressif; un en profil finals. Temps rapportés au début de parole source estimé. La file de lecture est simulée à partir des vrais paquets PCM. Un premier paquet négatif peut être du silence renvoyé avant la parole source.\n\n'
text+=table(['Chaîne','OK / essais','Extraits','Premier paquet p50 (ms)','Parole p50 (ms)','Parole p95 (ms)','Retard final p50 (ms)'],[[r['model'],f"{r['success']} / {r['trials']}",r['cases'],num(r['packetP50']),num(r['speechP50']),num(r['speechP95']),num(r['endLagP50'])] for r in rows('e2e')])
text+='''
Le profil agressif peut lire une mauvaise transcription qui sera corrigée plus tard. Le délai de premier son n'est donc pas une preuve d'utilité. Le retard final révèle également les files de lecture qui s'accumulent. Un échec de concurrence chez Deepgram est conservé dans les tentatives; aucun essai raté n'est converti en zéro milliseconde.

## Vérification du sens

Un évaluateur GPT-6.1 Sol a comparé les textes aux sources et à des traductions humaines du corpus. Il s'agit d'un repérage automatisé d'erreurs, pas d'une validation humaine. Le tableau porte sur les sorties distinctes et les couvertures diffèrent : il ne faut pas comparer les taux comme un classement statistique homogène.

'''
text+=table(['Modèle / chaîne','Textes distincts','Note moyenne / 4','Alertes graves'],[[r['model'],r['outputs'],r['scoreMean'],r['criticalFlags']] for r in rows('quality')])
text+='''
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
'''
(root/'RESULTATS.md').write_text(text)
print(root/'RESULTATS.md')
