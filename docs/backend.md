# Backend : comptes et préférences

Ce guide décrit le socle implémenté dans `apps/server` et la manière de le brancher au futur frontend.

Le serveur expose déjà des procédures de compte et de préférences, protégées par Better Auth et persistées dans PostgreSQL. **Aucune méthode de connexion n’est encore activée et le frontend n’est pas branché.** Les routes audio continuent d’utiliser leurs sessions anonymes existantes.

## Rôle de chaque outil

- **Hono** reçoit les requêtes HTTP, applique les middlewares et monte les routes.
- **oRPC** organise les opérations du backend en procédures appelables par un client TypeScript typé.
- **Zod** valide les données à l’exécution. Les types TypeScript seuls ne protègent pas une requête réseau.
- **Better Auth** vérifie les sessions utilisateur et fournit l’identité du compte connecté.
- **Drizzle** définit les tables en TypeScript et construit les requêtes SQL.
- **PostgreSQL** conserve les données et applique les contraintes de la base.

Le frontend n’accède jamais directement à PostgreSQL. Un appel comme `rpc.preferences.get()` reste une requête HTTP au serveur.

## Organisation du code

Tous les chemins suivants sont relatifs à `apps/server/` :

```text
src/
  server.ts                Démarrage Node et fermeture du pool PostgreSQL
  app.ts                   Assemblage Hono, CORS, limites HTTP et routage
  auth.ts                  Better Auth, adapter Drizzle et transport Bearer
  routes/
    status.get.ts          GET /api/status
    session.post.ts        POST /api/session
    interpret.post.ts      POST /api/interpret
    voice-clone.post.ts    POST /api/voice/clone
    voice-delete.post.ts   POST /api/voice/delete
  rpc/
    base.ts                Contexte et protectedProcedure
    router.ts              Assemblage des procédures et export du type ApiClient
    account.me.ts          Compte connecté
    preferences.get.ts     Lecture des préférences
    preferences.update.ts  Écriture des préférences
    preferences.schema.ts  Validation partagée des préférences
  db/
    index.ts               Instance Drizzle et pool PostgreSQL partagés
    schema.ts              Tables et contraintes
    migrate.ts             Exécution des migrations
  lib/
    http.ts                Middleware de session anonyme, validation JSON, noStore
    …                      Traduction, voix, sessions anonymes et validation
drizzle/                   Migrations SQL et métadonnées versionnées
drizzle.config.ts          Configuration de génération des migrations
```

La connexion et l’instance d’authentification sont initialisées à la demande. L’interpréteur peut donc démarrer sans les nouvelles variables de configuration. Le serveur seul ne lance aucune migration ; la commande de développement complète `pnpm dev:server` les applique avant de démarrer l’API.

## Routage

- `/api/auth/*` est transmis à Better Auth pour les requêtes GET et POST.
- `/rpc/*` est transmis au handler oRPC. Toutes les procédures actuelles nécessitent une session utilisateur.
- `/api/status`, `/api/session`, `/api/interpret` et `/api/voice/*` restent les routes de l’interpréteur.

Le [router](../apps/server/src/rpc/router.ts) regroupe les opérations par sujet :

```ts
export const router = {
  account: { me },
  preferences: { get, update },
};
export type ApiClient = RouterClient<typeof router>;
```

Le futur client oRPC utilise `ApiClient`, exporté par `@interprete/server/rpc`. Le client audio actuel conserve `hc<AppType>`, exporté par `@interprete/server`.

### Pourquoi deux dossiers ?

Les deux exposent des appels HTTP. `routes/` contient les endpoints déclarés directement avec Hono : chaque fichier correspond à une URL et à son verbe réel. `rpc/` contient les procédures oRPC : chaque fichier correspond à une opération appelée par le client typé. Le client Hono existant est lui aussi typé ; le découpage distingue les mécanismes de transport et de traitement des requêtes.

Les fichiers sont à plat dans chaque dossier. Dans `routes/`, `voice-delete.post.ts` correspond à `POST /api/voice/delete`. Dans `rpc/`, `preferences.get.ts` désigne l’opération `preferences.get()` ; le client oRPC utilise POST par défaut, même pour cette lecture.

Les noms de fichiers ne configurent aucun routage automatique. `app.ts` monte explicitement chaque endpoint Hono sous `/api`, en conservant la chaîne de déclarations pour l’inférence de `AppType`. `rpc/router.ts` assemble explicitement les procédures : ses clés déterminent les chemins, par exemple `/rpc/preferences/update`. Better Auth conserve son montage unique sous `/api/auth/*`.

Renommer ou déplacer ces fichiers ne change donc ni les URLs ni les verbes HTTP. Une migration des routes audio vers oRPC serait un changement séparé, avec adaptation du client et du streaming.

## Parcours d’une modification de préférences

Pour `rpc.preferences.update({ sourceLanguage: "fr", targetLanguage: "en" })` :

1. Hono applique les CORS et la limite de corps de 25 000 octets sur `/rpc/*`. Une origine présente mais non autorisée est refusée.
2. Le handler oRPC sélectionne `preferences.update` et reçoit le contexte `{ headers, auth, db }`.
3. `protectedProcedure` demande à Better Auth de vérifier la session. Sans session valide, l’appel échoue avec `UNAUTHORIZED`. Sinon, elle fournit `context.user`.
4. Le schéma Zod vérifie les deux langues : elles doivent être supportées et différentes. Les champs supplémentaires, dont `userId`, sont refusés.
5. Drizzle crée ou met à jour la ligne appartenant à `context.user.id`. L’identité ne vient jamais du corps envoyé par le client.
6. PostgreSQL applique ses contraintes. Zod valide ensuite la forme de la réponse avant son retour au client.

Le contrôle de session précède la validation métier de la procédure. Les contrôles HTTP, comme la taille du corps, peuvent refuser la requête plus tôt.

## Procédures disponibles

### `account.me()`

Retourne le compte connecté, avec uniquement :

```ts
{
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
}
```

Les jetons de session et les informations internes d’authentification ne figurent pas dans cette réponse.

### `preferences.get()`

Retourne `{ sourceLanguage, targetLanguage }`, ou `null` si aucune préférence n’a encore été sauvegardée. Le frontend choisira ses valeurs initiales dans ce dernier cas.

### `preferences.update(input)`

Accepte les **deux** langues et retourne les valeurs enregistrées :

```ts
await rpc.preferences.update({
  sourceLanguage: "fr",
  targetLanguage: "en",
});
// { sourceLanguage: "fr", targetLanguage: "en" }
```

Cette opération remplace la paire de langues ; ce n’est pas une modification partielle. Elle crée la ligne à la première sauvegarde puis met à jour la même ligne. Les langues disponibles proviennent de [packages/shared/src/languages.ts](../packages/shared/src/languages.ts).

## Données et sessions

Le [schéma Drizzle](../apps/server/src/db/schema.ts) contient cinq tables :

- `user` : identité du compte, email unique et informations publiques.
- `session` : sessions Better Auth, expiration et lien vers l’utilisateur.
- `account` : informations des méthodes d’authentification gérées par Better Auth.
- `verification` : données de vérification utilisées par Better Auth.
- `user_preferences` : utilisateur, langue source, langue cible et date de mise à jour.

`user_preferences.user_id` est à la fois la clé primaire et une référence vers `user.id` : un utilisateur possède au maximum une ligne de préférences. La suppression du compte supprime ses préférences, sessions et comptes d’authentification liés. Une contrainte SQL interdit deux langues identiques ; la liste des langues supportées est contrôlée par Zod.

Deux systèmes de session coexistent :

- **Interpréteur** : jeton anonyme signé avec `SESSION_SECRET`, obtenu via `/api/status` et stocké actuellement sous `interprete-session`.
- **Compte** : session Better Auth liée à un utilisateur en base, avec un secret distinct `BETTER_AUTH_SECRET`.

Le jeton anonyme ne donne aucun accès aux procédures de compte. Ajouter Better Auth ne réserve pas encore l’API audio aux utilisateurs connectés. Les locuteurs A/B et leurs autorisations de voix restent liés au fonctionnement existant.

## Démarrer en local

Prérequis : Node 22+, pnpm et Docker démarré avec Compose. Exécuter les commandes depuis la racine du dépôt.

```sh
pnpm install
```

Si `apps/server/.env.local` n’existe pas, le créer à partir de [`.env.example`](../apps/server/.env.example). Sinon, compléter le fichier existant. Les variables du nouveau socle sont :

```dotenv
DATABASE_URL=postgresql://interprete:interprete@localhost:5436/interprete
BETTER_AUTH_URL=http://localhost:3035
BETTER_AUTH_SECRET=<secret aléatoire de 32 caractères minimum>
```

Générer le secret localement avec `openssl rand -base64 32`. Utiliser une autre valeur pour `SESSION_SECRET`. `BETTER_AUTH_URL` désigne l’URL du serveur, sans suffixe `/api/auth` ou `/rpc`.

Dans un premier terminal, lancer tout le backend :

```sh
pnpm dev:server
```

Dans un second terminal, lancer le frontend :

```sh
pnpm dev:desktop
```

Le lanceur [scripts/dev-server.mjs](../scripts/dev-server.mjs) démarre PostgreSQL et attend son état sain, applique les migrations, puis lance l’API avec rechargement et Drizzle Studio. Si une étape de démarrage échoue ou qu’un des processus supervisés s’arrête, il arrête les autres composants. Docker doit être démarré au préalable.

Le fichier `.env.local` est chargé par les scripts serveur. PostgreSQL écoute sur `127.0.0.1:5436`, avec un volume persistant. Les identifiants du compose sont réservés au développement.

Vérifier le montage de Better Auth :

```sh
curl --fail http://localhost:3035/api/auth/ok
```

Cette route ne vérifie pas la connexion à PostgreSQL et ne connecte aucun utilisateur. La migration et les tests d’intégration vérifient réellement la base. Tant qu’aucune méthode de connexion n’est ajoutée, il n’existe pas de parcours public pour obtenir une nouvelle session utilisateur.

Pour arrêter le backend, utiliser **Ctrl+C** dans son terminal. Le lanceur arrête les processus API/Studio et exécute uniquement `docker compose stop db` : le conteneur et son volume nommé sont conservés. Aucune commande `down --volumes` n’est utilisée. Au prochain `pnpm dev:server`, les données sont réutilisées. Le terminal desktop s’arrête séparément avec Ctrl+C.

## Consulter la base avec Drizzle Studio

Studio démarre automatiquement avec `pnpm dev:server`. Ouvrir [Drizzle Studio](https://local.drizzle.studio) pour parcourir les tables et leurs données ; le serveur local écoute sur `127.0.0.1:4983`.

Pour un usage indépendant, `pnpm db:studio` lance seulement Studio contre une base déjà démarrée. Cette commande charge `apps/server/.env.local` et utilise son `DATABASE_URL`. Ne pas la lancer en parallèle du backend complet sur le même port. L’API Hono n’a pas besoin de tourner pour cet usage autonome.

Studio permet également de modifier les données de la base sélectionnée. Pour changer la structure des tables, conserver le workflow de migrations décrit plus bas.

## Brancher le futur frontend

Le serveur prend en charge les cookies Better Auth et le plugin Bearer. Pour Tauri, le choix du stockage sécurisé des jetons fait partie du futur parcours de connexion. Le header `set-auth-token`, émis par Better Auth lors de l’émission d’une session, est exposé par les CORS aux origines autorisées.

Installer le client dans le desktop au moment de cette intégration :

```sh
pnpm --filter @interprete/desktop add --save-exact @orpc/client@1.16.1
```

Exemple de fabrique de client à placer côté frontend :

```ts
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ApiClient } from "@interprete/server/rpc";

export function createAccountClient(
  apiUrl: string,
  readToken: () => Promise<string | null>,
): ApiClient {
  return createORPCClient(new RPCLink({
    url: `${apiUrl}/rpc`,
    headers: async () => {
      const token = await readToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
  }));
}
```

`apiUrl` est l’URL de l’API, sans slash final. `readToken` sera fourni par le stockage choisi pour la session de compte ; il ne doit pas lire le jeton anonyme `interprete-session`. Le lire à chaque appel permet de tenir compte des connexions et déconnexions.

Après obtention d’une session valide, le client retourné permet d’appeler `rpc.account.me()`, `rpc.preferences.get()` et `rpc.preferences.update(...)`. L’import `type` ne transporte aucun code serveur ni secret dans le bundle desktop.

Les opérations privées sont définies côté serveur ; modifier une entrée ou une sortie modifie le type du client. Les contrôles Zod restent indispensables pour les requêtes reçues à l’exécution.

## Ajouter une procédure

1. Créer un fichier par opération, à plat dans `src/rpc/`, nommé `ressource.operation.ts` (par exemple `preferences.update.ts`). Partager les schémas dans `ressource.schema.ts` si plusieurs opérations les utilisent.
2. Définir la procédure à partir de `protectedProcedure` pour obtenir l’utilisateur vérifié.
3. Déclarer les entrées avec `.input(schemaZod)` et les données publiques retournées avec `.output(schemaZod)`.
4. Effectuer les requêtes simples avec `context.db`. Filtrer les données privées par `context.user.id` ; être connecté ne donne pas accès aux données des autres utilisateurs.
5. Importer la procédure et l’ajouter sous sa ressource dans `src/rpc/router.ts`. Le préfixe `/rpc` est déjà monté dans Hono, sans route HTTP supplémentaire à écrire.
6. Ajouter les tests de validation et, si la base intervient, les tests d’accès entre deux utilisateurs.

Pour un endpoint Hono, créer un fichier `chemin.methode.ts` dans `src/routes/` et le monter explicitement dans `app.ts`. Réutiliser les contrôles de `lib/http.ts` pour les routes de l’interpréteur.

Les schémas d’entrée doivent décrire les champs modifiables, pas recopier aveuglément toute une table. Extraire une fonction métier lorsqu’un traitement devient complexe ou partagé.

## Faire évoluer la base

Modifier `src/db/schema.ts`, puis générer une migration :

```sh
pnpm --filter @interprete/server db:generate
```

Relire le SQL généré et versionner l’ensemble des nouveaux fichiers dans `apps/server/drizzle/`, y compris les métadonnées. Appliquer ensuite les migrations :

```sh
pnpm --filter @interprete/server db:migrate
```

La génération ne nécessite pas de connexion PostgreSQL ; l’application des migrations utilise `DATABASE_URL`. Une migration déjà appliquée n’est pas rejouée. Pour modifier un schéma déjà déployé, créer une nouvelle migration plutôt que modifier l’ancienne.

L’ajout d’une méthode ou d’un plugin Better Auth peut nécessiter une évolution de ses tables : synchroniser le schéma Drizzle et la migration correspondante.

## Vérifier le backend

Les vérifications courantes ne nécessitent pas PostgreSQL :

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build:server
```

Pour l’intégration PostgreSQL, créer une base dédiée une seule fois :

```sh
docker compose -f docker-compose.db.yml exec db createdb -U interprete interprete_test
```

Puis lancer :

```sh
TEST_DATABASE_URL=postgresql://interprete:interprete@localhost:5436/interprete_test pnpm --filter @interprete/server test:db
```

Les tests du lanceur, inclus dans `pnpm test`, vérifient l’ordre de démarrage, l’arrêt des processus enfants, une migration en échec et une interruption pendant le démarrage. Ils utilisent des commandes simulées pour vérifier que l’arrêt conserve le volume.

Le test PostgreSQL applique les migrations deux fois pour vérifier leur réexécution, crée ses utilisateurs et de vraies sessions Better Auth, puis supprime ses données. Il couvre la persistance, l’isolation entre comptes, les entrées invalides, les sessions expirées/révoquées et les contraintes de relation. Il n’active aucune méthode de connexion et n’appelle pas les fournisseurs IA. `TEST_DATABASE_URL` doit désigner la base de test, car des migrations y sont appliquées.

## Déployer

L’image contient `dist/server.mjs`, `dist/db/migrate.mjs` et les migrations SQL. Le compose principal expose l’API derrière Caddy ; le compose PostgreSQL séparé sert au développement.

Configurer dans `apps/server/.env.local` une base PostgreSQL accessible depuis le conteneur, l’URL HTTPS publique du serveur et un secret Better Auth distinct. `localhost` à l’intérieur du conteneur désigne ce conteneur, pas la machine hôte.

```sh
API_DOMAIN=api.example.com docker compose build api
API_DOMAIN=api.example.com docker compose run --rm api node dist/db/migrate.mjs
API_DOMAIN=api.example.com docker compose up -d
```

Remplacer le domaine d’exemple et n’exécuter l’étape de migration qu’une fois par déploiement, avant le démarrage de la nouvelle API. Les limites de requêtes restent en mémoire ; le déploiement actuel suppose une seule instance.

## Diagnostiquer un appel

- **503 `AUTH_NOT_CONFIGURED`** : vérifier `BETTER_AUTH_URL` et la longueur de `BETTER_AUTH_SECRET`.
- **503 `DATABASE_NOT_CONFIGURED`** : vérifier que `DATABASE_URL` est une URL PostgreSQL valide. Une URL valide ne garantit pas que la base soit joignable.
- **401 `UNAUTHORIZED`** : aucune session Better Auth valide ; un jeton anonyme de l’interpréteur ne suffit pas.
- **400 `BAD_REQUEST`** : entrée oRPC invalide, par exemple langue inconnue, deux langues identiques ou champ supplémentaire.
- **403 `ORIGIN` sur `/rpc/*`** : l’origine envoyée ne figure pas dans `ALLOWED_ORIGINS`.
- **413** : le corps dépasse la limite HTTP de 25 000 octets.
- **Erreur de base ou migration** : vérifier l’accès à PostgreSQL depuis l’environnement qui exécute la commande et l’application des migrations.

Les procédures utilisent le protocole d’erreur oRPC, décodé par son client. Les erreurs HTTP en amont et les routes audio conservent le format `{ error, code }`. Le client audio existant `call()` ne doit donc pas servir de décodeur pour les nouvelles procédures.

## Travail restant pour le produit

Choisir et activer les méthodes de connexion, intégrer leur parcours dans Tauri, décider du stockage des jetons et brancher les écrans sur oRPC. La reprise des préférences locales, le rattachement des voix aux comptes et la protection de l’API audio par les comptes nécessitent des changements explicites. Aucun historique de conversation n’est enregistré dans cette base.
