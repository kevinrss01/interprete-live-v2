# Benchmark reproductible

Les résultats sont ceux d'un banc d'essai local, pas d'une application déployée. Les clés sont dans `.env.local`, ignoré par Git et protégé en lecture. Le rapport n'en contient aucune.

## Données

`benchmark-corpus/manifest.json` décrit 12 enregistrements humains du test Google FLEURS : quatre en français, quatre en anglais, quatre en espagnol. Les SHA-256 permettent de vérifier l'entrée PCM exacte. Les textes de référence et les traductions humaines sont conservés. Licence du corpus : CC-BY 4.0.

`python3 scripts/corpus.py` récupère seulement le début des archives nécessaires. `node scripts/align.mjs` obtient des horaires estimés de mots via l'API d'alignement ElevenLabs. Cette dernière commande consomme le service.

## Commandes

```sh
npm install
node --test tests/metrics.test.mjs
REPS=3 npm run benchmark -- stt
REPS=3 npm run benchmark -- tts
npm run benchmark -- translation
npm run benchmark -- decision
npm run benchmark -- prediction
REPS=2 REP_START=10 npm run benchmark -- native
CASES=fr-1,fr-2,en-1,en-2,es-1,es-2 REPS=2 npm run benchmark -- pipeline
POLICY=final CASES=fr-1,fr-2,en-1,en-2,es-1,es-2 REPS=1 npm run benchmark -- pipeline
npm run benchmark -- quality
node scripts/recompute-output.mjs
python3 scripts/snapshot.py
python3 scripts/write-report.py
```

Les commandes de benchmark effectuent de vrais appels facturables. Les erreurs de crédit, de quota et de connexion restent dans les journaux. Aucun rechargement ni abonnement automatique.

## Résultats

- `benchmark-results/*.jsonl` : journaux append-only de chaque essai.
- `stt.jsonl` : transcription, événements, WER, durées et paramètres de trames.
- `tts-final.jsonl` : essai final avec chronologie PCM et détection de parole ; `tts.jsonl` conserve la présélection.
- `translation.jsonl`, `decision.jsonl`, `prediction-final.jsonl`, `routing.jsonl` : tests texte ; l'ancien `prediction.jsonl` conserve la présélection.
- `native.jsonl` : les répétitions 10 et 11 contiennent la chronologie audio complète retenue.
- `pipeline-stream.jsonl` : chaînes en streaming persistant. Les échecs de concurrence sont conservés.
- `quality.jsonl` : triage sémantique automatique par GPT-6.1 Sol ; ce n'est pas une validation humaine.
- `reviewed-snapshot.json` : agrégats qui alimentent le rapport.

La présélection a révélé deux pièges de mesure : les premiers paquets OpenAI peuvent être silencieux ; et une trame de 100 ms ne peut être disponible qu'après ses 100 ms de capture. Les journaux historiques de streaming sont ancrés au premier envoi. L'agrégateur ajoute donc une durée de trame (80 ms pour Deepgram, 100 ms ailleurs) avant de comparer aux horaires de l'audio source. Il distingue le premier paquet, le début de parole détecté et la fin de parole. Les valeurs sont une simulation de lecture à partir des paquets reçus, pas un chronométrage acoustique.

Pour la vitesse de transcription, seuls les mêmes mots correctement reconnus par tous les fournisseurs sont comparés. La WER séparée couvre tous les mots des réponses reçues, y compris les omissions. Les pannes réseau ne sont pas transformées en zéro erreur ; elles figurent dans le taux de succès.

Les agrégats STT utilisent les trois derniers essais par fournisseur et extrait, afin d'écarter les prévols techniques sans changer la composition du corpus. La comparaison des chaînes utilise une intersection explicite des extraits entre tous les bras. Les derniers deux essais par bras/extrait sont retenus, un seul pour le profil `finals`. Les effectifs restent affichés. Les logs bruts permettent de vérifier ces sélections.

Les profils `stable` sont volontairement agressifs : un préfixe identique dans deux transcriptions provisoires peut encore être faux. Les erreurs prononcées ne peuvent pas être annulées ; elles ne doivent pas être dissimulées par la bonne transcription finale. Le profil `finals` sert de contrôle plus conservateur.

## Rapport

Le projet du rapport est `report/`. Il utilise le runtime de rapport installé, sans clé API ni appels modèles côté navigateur. Servir `report/dist/` sur HTTP ; le fichier de données latéral fait partie de la livraison. `report/.data-app-offline/exports/` contient la version HTML autonome lorsqu'elle a été exportée.
