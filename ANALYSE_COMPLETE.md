# ANALYSE COMPLÈTE — SALON PRO (barbershop)

**Date de l'analyse :** 30 octobre 2026
**Branche auditée :** `arena/fcbc43cf-barbershop` (commit de base `d25a980`, merge PR #1)
**Périmètre :** `src/`, `server/`, `api/`, `db/`, configuration de build, tests, documentation, sécurité, performance, déploiement.
**Nature :** audit statique + exécution réelle de la chaîne qualité (installation, lint, tests, build, serveur de développement et sondes HTTP).

---

## 0. Synthèse exécutive

SALON PRO est une application **mono-salon, offline-first, en français, avec des montants entiers en FCFA**, couvrant 11 rubriques métier (tableau de bord, caisse, recettes, dépenses, prestations, personnel, paie, inventaire, rapports, budget, paramètres) et 2 écrans d'authentification, adossée à **deux bases** : IndexedDB (Dexie) côté navigateur et PostgreSQL Neon côté cloud, reliées par une synchronisation bidirectionnelle « dernier écrivain gagne ».

Le niveau fonctionnel est **remarquable pour un projet de cette taille** : le périmètre réel correspond à ce que promet le README (tickets multi-lignes, paiements mixtes, consommables cabine, avances/paie partielle, CUMP, rapports, journal d'audit, tombstones, purge des données fictives). La chaîne qualité est verte **au moment de l'audit** : `oxlint` 0 erreur / 0 avertissement, **49/49 tests** passés, `tsc -b` et `vite build` OK.

En revanche, trois familles de risques empêchent aujourd'hui une mise en production sereine sur un déploiement **multi-utilisateurs exposé à Internet** :

1. **Sécurité / autorisation** : la synchronisation pousse la table des comptes utilisateurs (hash de mot de passe + rôle) avec une autorisation « n'importe quelle session valide ». Un compte **Caissier** peut donc s'auto-promouvoir Gérant par un simple appel `POST /api/sync` forgé. Le RBAC n'est appliqué que dans l'UI React.
2. **Robustesse de la synchronisation** : elle est *full-state*, ligne par ligne, sans delta ni batching : le coût par enregistrement croît linéairement (≈ 1 requête SQL par ligne, à chaque mutation, après un debounce de 1,6 s). La résolution de conflits (LWW sur horloge client) ne protège pas les agrégats dérivés (caisse, stocks) et le numéro de reçu n'est pas unique.
3. **Industrialisation** : aucune CI (alors que `AGENTS.md` impose `lint && test && build`), aucun *error boundary*, pas de *service worker* malgré la promesse « hors-ligne », pas de limitation de tentatives de connexion, bundle principal à 534 kB.

**Verdict global : projet très solide fonctionnellement (8/10), à durcir avant exposition publique (sécurité 4/10, scalabilité 5/10, industrialisation 4/10).** Les correctifs P0 sont ciblés et représentent environ 1 à 2 jours de travail.

| Axe | Note | Commentaire court |
|---|---|---|
| Couverture fonctionnelle | 9/10 | 11 rubriques + outils transverses, largement conformes au README |
| Architecture | 7/10 | Séparation domaine / persistance / UI claire, mais hub de 3 553 lignes |
| Justesse métier (calculs) | 8/10 | Intégrité FCFA, paie/avances bien raisonnées ; quelques ambiguïtés |
| Sécurité | 4/10 | Escalade de privilèges via `/api/sync`, RBAC client, pas d'anti-bruteforce |
| Performance / scalabilité | 5/10 | Sync full-state O(N) requêtes, rechargement complet de l'état à chaque mutation |
| Tests | 6/10 | 49 tests verts ; paie/rapports peu couverts, aucun test du scénario d'escalade |
| Qualité de code | 7/10 | TS strict, zéro `any`, zéro `console`, mais fichiers très longs |
| Documentation | 7/10 | README riche et AGENTS.md utile ; 3 incohérences doc ↔ code |
| Industrialisation / DevOps | 4/10 | Pas de CI, pas de monitoring, pas de migrations versionnées |

---

## 1. Méthode et vérifications réellement exécutées

| Étape | Commande | Résultat |
|---|---|---|
| Installation | `npm ci` | 187 paquets, 8 s, lockfile respecté |
| Lint | `npx oxlint` | **0 warning, 0 erreur**, 103 fichiers, 116 règles |
| Tests | `npx vitest run` | **11 fichiers / 49 tests passés**, 35 s (jsdom + fake-indexeddb) |
| Typage | `npx tsc -b` | OK (aucune erreur) |
| Build prod | `npx vite build` | OK en 1,25 s ; `dist` ≈ 1,7 Mo |
| Serveur dev | `npm run dev` | Vite 8.3.5 prêt en 294 ms, écoute `0.0.0.0:5173` |
| Sonde API | `GET /api/health` | `{"ok":true,"databaseConfigured":false,"pinRequired":false}` |
| Sonde API | `POST /api/sync` (sans jeton) | `401 INVALID_PIN` ✅ (contrôle d'accès effectif) |
| Sonde API | `GET /api/auth/status` (sans DB) | `503 DB_NOT_CONFIGURED` → repli local attendu |
| Sonde front | `GET /`, `/manifest.webmanifest` | `200`, `200` |

> Remarque d'environnement : `node_modules` était absent au départ ; `npm ci` a été nécessaire. Aucun test n'a été modifié ni ajouté pour cet audit.

---

## 2. Fiche d'identité du projet

| Élément | Valeur |
|---|---|
| Nom / package | `salon-pro` v1.0.0, `private` |
| Domaine | Gestion financière et administrative de salon de coiffure / barbershop |
| Devise | XOF — **entiers uniquement**, aucun flottant monétaire |
| Langue | Français (UI, messages d'erreur, noms de champs métier) |
| Front | React 19.3, React Router 7 (routes `lazy`), TypeScript ~7.0, Vite 8.3 |
| UI / animation | Composants maison (~20 primitives), framer-motion 14, lucide-react 1.x, recharts 3.10 |
| État | 6 contextes React + 1 store applicatif (`SalonStoreProvider`) |
| Persistance locale | IndexedDB via Dexie 4.4 (19 tables, 4 versions de schéma) |
| Persistance cloud | PostgreSQL Neon (`pg` 8.23) — 19 tables, `payload_json` JSONB + colonnes dénormalisées |
| API | 7 routes HTTP maison (`server/apiHandler.ts`), aucun framework serveur |
| Déploiement | Vercel (`api/[...route].ts` + `vercel.json`) ou Vite dev/preview |
| Tests | Vitest 4 + Testing Library + jsdom + fake-indexeddb |
| Lint | Oxlint (plugins react, typescript, oxc) |
| Volumétrie | **104 fichiers**, **37 671 lignes** dans `src/server/api/db` (101 fichiers TS/TSX, 3 092 lignes de CSS) |
| Historique | 1 commit de merge (projet livré d'un bloc via PR) |

---

## 3. Architecture

### 3.1 Vue d'ensemble

```
                    ┌────────────────────────────────────────────┐
                    │                NAVIGATEUR                  │
                    │                                            │
  React 19 ─────────►  App.tsx                                 │
                    │   ├── MotionConfig(reducedMotion:user)     │
                    │   ├── ToastProvider                        │
                    │   ├── SalonStoreProvider  ◄── état global  │
                    │   ├── BrowserRouter                        │
                    │   ├── AuthProvider                         │
                    │   └── AppRoutes                            │
                    │        └── CloudSync / Period / Cash /     │
                    │            WorkspaceFocus / QuickAction    │
                    │                                            │
                    │  features/*  ──► domain/calculations       │
                    │       │        └─ domain/validators        │
                    │       ▼                                    │
                    │  SalonRepositoryHub (3 553 lignes)         │
                    │       │   transactions Dexie multi-tables  │
                    │       ▼                                    │
                    │  IndexedDB (19 tables + tombstones)        │
                    └───────────────┬────────────────────────────┘
                                    │ fetch /api/*
                    ┌───────────────▼────────────────────────────┐
                    │  NODE (Vite middleware en dev, Vercel λ)   │
                    │  apiHandler.ts (routeur, corps ≤ 15 Mo)    │
                    │   ├── authEngine.ts  PBKDF2 + HMAC-SHA256  │
                    │   ├── syncEngine.ts  push/pull LWW         │
                    │   ├── neonSchema.ts  DDL idempotent        │
                    │   └── neonClient.ts  Pool pg (max 5)       │
                    └───────────────┬────────────────────────────┘
                                    │ pg
                    ┌───────────────▼────────────────────────────┐
                    │  PostgreSQL Neon — 19 tables + tombstones  │
                    └────────────────────────────────────────────┘
```

### 3.2 Découpage des couches

| Couche | Emplacement | Rôle | Qualité |
|---|---|---|---|
| Domaine pur | `src/domain/models`, `calculations/finance.ts` (1 061 l.), `validators` | Types, calculs testables sans I/O | ✅ Bon, testé |
| Persistance | `src/db/database.ts`, `repositories/salonRepositories.ts` | Dexie, transactions, règles métier d'écriture | ⚠️ Fichier monolithique |
| État | `src/hooks/SalonStoreProvider.tsx` | Rechargement complet + `mutationCount` | ⚠️ Coût O(N) par mutation |
| Contextes transverses | `src/contexts/*` (6 providers + 6 contextes typés) | Auth, sync cloud, période, caisse, actions rapides, focus | ✅ Bon découpage |
| UI métier | `src/features/*` (12 dossiers) | 11 écrans métier + auth | ⚠️ Écrans de 600 à 1 775 lignes |
| Design system | `src/components/ui`, `patterns`, `reui` | 18 primitives `ui` + 12 patterns `c-*`, styles inline + 2 950 l. de CSS global | ⚠️ Duplication |
| Serveur | `server/*`, `api/*` | Auth, sync, schéma, pool | ✅ Bien isolé du client |
| Base SQL | `db/schema.sql` + `server/neonSchema.ts` | DDL (dupliqué) | ⚠️ Risque de dérive |

**Point fort notable :** la séparation est *réelle*, pas cosmétique. `domain/calculations/finance.ts` ne connaît ni Dexie ni React ; les composants ne parlent jamais à Dexie directement, tout passe par le hub ; le serveur ne dépend du front que pour les **types** (`src/domain/models/index.ts`, inclus explicitement dans `tsconfig.node.json`).

### 3.3 Les six contextes transverses

| Contexte | Responsabilité | Observation d'audit |
|---|---|---|
| `SalonStoreContext` | État global, `mutate()` | Chaque mutation relit **les 17 tables** (`readFullState`) |
| `CloudSyncContext` | Sync auto (debounce 1 600 ms), statuts, prefs localStorage | Envoie l'état **complet** à chaque synchronisation |
| `PeriodFilterContext` | Période d'analyse partagée | Cohérent, 8 valeurs dont personnalisé |
| `CashSessionContext` | Session ouverte, solde théorique, détection session de la veille | Bonne idée métier (`isSessionStale`) |
| `QuickActionContext` | Ticket, dépense rapide, ouverture caisse, reçu | Réutilisé depuis tous les écrans métier |
| `WorkspaceFocusContext` | Deep-links depuis ⌘K et alertes | Bien intégré au tableau de bord |

### 3.4 Routage et contrôle d'accès

Routes protégées par `RequireAuth` puis `RequireManagerRole` (`src/app/router.tsx`). Rôles : **Gérant** / **Caissier**. `/budget`, `/employees`, `/payroll`, `/reports`, `/settings` sont réservés au Gérant, à la fois dans le routeur et via `canUserAccessPath` pour la navigation.

> ⚠️ Ce contrôle est **exclusivement côté client**. IndexedDB contient l'intégralité des données (paie, salaires, marges) et un Caissier muni des DevTools peut ouvrir la base locale ou appeler `/api/sync` directement. Voir §6.

### 3.5 Build et déploiement

- `vite.config.ts` : plugin maison `salonNeonApiPlugin()` qui monte `handleSalonApiRequest` sur `configureServer` **et** `configurePreviewServer` — élégant : les mêmes routes `/api/*` marchent en `dev`, `preview` et sur Vercel, sans serveur Express séparé.
- `vercel.json` : rewrite SPA + API, cohérent.
- `server` est typé par un `tsconfig.node.json` distinct (bonne pratique).
- `dist/` et `node_modules/` correctement ignorés ; `.env*` et `.salon-auth-secret` exclus de Git. ✅

---

## 4. Persistance et synchronisation

### 4.1 Modèle local (Dexie)

19 tables, 4 versions successives (`version(4)` courante) : `salon, settings, categories, services, employees, revenues, expenses, cashSessions, cashMovements, advances, bonuses, salaryPayments, products, stockMovements, budgets, recurringExpenses, users, correctionLogs, syncTombstones`.

L'`upgrade` de la v4 est le point le plus original du projet : il purge les enregistrements hérités de démonstration (`isLegacyMockRecord`), **écrit des tombstones persistants** (`syncTombstones`) et une version d'hygiène dans `settings` (`dataHygieneVersion`). C'est une réponse sérieuse au problème classique « j'ai supprimé les données de démo, le cloud me les a ramenées ».

**Risque associé :** la même purge est rejouée à *chaque* connexion et à *chaque* synchronisation, côté client **et** côté serveur (`readFullCloudState` appelle `readAndPurgeMockRows` sur 14 tables → jusqu'à 14 `SELECT *` + `DELETE` unitaires). Coût non négligeable sur une base qui grossit, et logique de suppression très large (toute ligne dont un champ FK commence par `demo-`, `rec-tpl-`, `tpl-std-`, `rec-std-`).

### 4.2 Modèle cloud

Chaque table combine : clés/index colonnaires (`id`, `date`, `session_id`, `status`…) **et** un `payload_json JSONB` contenant l'objet complet. Pattern « document + index » pragmatique pour une app offline-first, mais qui duplique la vérité (les colonnes dénormalisées ne sont pas recalculées depuis le JSON ; risque de divergence si un champ indexé évolue).

`db/schema.sql` et `server/neonSchema.ts` déclarent **exactement les mêmes 19 tables** (vérifié par diff : identiques). La duplication reste un risque de dérive à moyen terme — le DDL devrait être généré depuis une source unique.

### 4.3 Cycle de synchronisation

```
Client                                   Serveur (Neon)                PostgreSQL
  │  buildCloudSyncEnvelope()                 │                            │
  │   • readFullState() (17 tables)           │                            │
  │   • users (avec passwordHash)             │                            │
  │   • tombstones                            │                            │
  ├──── POST /api/sync (JSON ≤ 15 Mo) ───────►│                            │
  │                                           │ BEGIN                      │
  │                                           │ pour chaque ligne (loop):  │
  │                                           │   INSERT … ON CONFLICT     │
  │                                           │   WHERE EXCLUDED.updated_at│
  │                                           │         > table.updated_at │
  │                                           │   (1 requête / ligne) ─────►
  │                                           │ DELETE selon tombstones    │
  │                                           │ readFullCloudState()       │
  │                                           │ COMMIT                     │
  │◄── payload complet + tombstones ──────────┤                            │
  │  mergeCloudSyncResult()                   │                            │
  │   • LWW par updatedAt (get + put / ligne) │                            │
```

**Ce qui est bien fait :** comparaison `EXCLUDED.updated_at > table.updated_at` (idempotence des rejouements), tombstones appliqués avec garde `tsCol <= deleted_at`, transaction avec `ROLLBACK`, purge anti-données-fictives intégrée, distorsion réseau traitée (`ENOTFOUND`, `ECONNREFUSED`, `timeout` → `503 NETWORK_UNREACHABLE` + message rassurant, l'app continue en local).

**Ce qui pose problème :**
- **Autorisation du push** : voir §6 (P0-1).
- **Volume** : 1 requête SQL par enregistrement, en série ; renvoi de **tout** l'état au client à chaque cycle ; le client réécrit ensuite chaque ligne (`get` + `put`).
- **Conflits** : LWW sur `updatedAt` produit par l'horloge du navigateur (non fiable, non monotonique). Aucun vecteur de causalité, aucune fusion par champ.
- **Agrégats dérivés non réconciliés** : `theoreticalClosingBalance`, `totalCashIn/Out`, `quantity` des produits (stock) sont recalculés localement et écrasés par LWW ; deux caisses simultanées peuvent produire un solde théorique faux et des stocks incohérents.
- **Numéros de reçu non uniques** : `generateReceiptNumber` utilise `Set.size + 1` (`salonRepositories.ts:786`) — après annulation/archivage, un numéro peut être **réattribué**, et deux appareils hors-ligne génèrent le même `REC-AAAAMMJJ-001`. Aucune contrainte `UNIQUE` en SQL sur `receipt_number`.
- **Pas de tenant** : aucune colonne `salon_id`/`tenant_id` en base. Un déploiement = un salon. Toute ambition SaaS multi-salons impose une refonte du schéma et des requêtes.

---

## 5. Revue de justesse métier

| Module | Points vérifiés | Verdict |
|---|---|---|
| **Caisse** | Une seule session `open` à la fois ; `calculateCashSessionSummary` (in/out/corrections) ; écart = compté − théorique ; mouvements interdits sur session clôturée ; corrections tracées dans `correctionLogs` ; billetage FCFA (10 000 → 25) | ✅ Solide. Les corrections de clôture sont bien journalisées. |
| **Recettes / ticket** | Validation par ligne, somme des splits = total, reçu séquentiel, alimentation caisse **uniquement** pour la part espèces, consommables décrémentés sans surfacturation, réintégration du stock à l'annulation | ✅ Bon. Réserves : unicité du reçu (ci-dessus) et absence de contrainte d'unicité sur `ticketId`. |
| **Dépenses / récurrentes** | Charges fixes mensuelles validables en 1 clic, période `recurringPeriodMonth` anti-doublon, pont vers l'inventaire pour éviter le double comptage (`isStockPurchase`) | ✅ Bonne intuition métier. |
| **Prestations** | Catalogue, variantes de prix, consommables par défaut, commission par prestation (override taux/fixe), verrouillage tarifaire pour le Caissier | ✅ Riche. |
| **Personnel / commissions** | 3 bases de commission (prestations seules par défaut, prestations+produits, CA global) | ✅ Conforme. *Ambiguïté* : en base `total_revenue`, **chaque** employé commissionné touche un pourcentage du CA global (voulu, mais à documenter dans l'UI). |
| **Paie / avances** | Rapprochement des avances non imputées, paiement partiel (acompte) sans double déduction, `fullRemainingNet = base + primes + commission − retenues − avances réglées − avances non réglées − déjà payé`, une seule écriture de dépense par versement | ✅ **Le point le plus abouti du projet** (voir `salonRepositories.ts:2077-2270` et `calculateEmployeePayrollStatus`). Cas limite : `defaultBonus` est ajouté chaque mois *en plus* des primes saisies — risque de double comptage si l'utilisateur ressaisit la prime récurrente. |
| **Inventaire** | CUMP recalculé à l'achat (`calculateCUMP`), mouvements `purchase/use/sale/loss/adjustment`, seuils d'alerte, `quantityAfter` historisé | ✅ Correct. `quantityAfter` étant dérivé, il peut diverger après fusion multi-appareils. |
| **Rapports** | 8 états dont rapprochement par mode de paiement et journal d'audit avec diff avant/après (`computeAuditDiffEntries`) | ✅ Bon. |
| **Budget** | Objectif, plafonds par catégorie, pré-alerte 85 %, run-rate de fin de mois, reconduction 1 clic | ✅ Conforme. |
| **Tableau de bord** | KPI + variation vs période précédente, alertes proactives (caisse de la veille, sauvegarde > 7 j, budget, ruptures, salaires en attente, charges fixes) | ✅ L'une des meilleures parties (pédagogie métier). |
| **Intégrité FCFA** | `toIntFCFA` = `Math.round`, `validatePositiveFCFA`/`validateNonNegativeFCFA` refusent les non-entiers, `BIGINT` SQL | ✅ Discipline respectée de bout en bout. |

---

## 6. Sécurité (findings détaillés)

### 🔴 P0-1 — Escalade de privilèges via la synchronisation

**Fichiers :** `server/syncEngine.ts:801-853`, `server/apiHandler.ts` (§3 routes `/api/sync*`), `src/db/repositories/salonRepositories.ts:2961`.

Le client envoie dans son *payload* de synchronisation l'intégralité de la table `users`, **`passwordHash` inclus**. Le serveur l'écrit sans contrôle de rôle :

```sql
INSERT INTO salon_users (…, role, password_hash, …)
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  password_hash = EXCLUDED.password_hash, …
WHERE EXCLUDED.updated_at > salon_users.updated_at
```

Or l'accès à `/api/sync` est accordé à **toute session authentifiée**, quel que soit le rôle.

**Scénario d'attaque** (aucune compétence avancée requise) : un Caissier récupère son jeton (localStorage), forge `POST /api/sync` avec `payload.users = [{ id: <son id>, role: "manager", passwordHash: <hash qu'il choisit>, updatedAt: <futur> }]` → il devient Gérant, et peut aussi **écraser le hash du gérant légitime** (verrouillage du compte), ou modifier salaires, paie, dépenses de toute la base (les 14 autres tables sont également acceptées sans contrôle).

**Reproduit pendant l'audit** (test temporaire, exécuté puis supprimé) : un appel direct à `syncWithNeonDatabase(pool, envelope)` avec un `payload.users` forgé à `role: 'manager'` déclenche bien `INSERT INTO salon_users … VALUES ($1,…,$5,…)` avec `$5 = 'manager'` — aucune vérification du rôle appelant n'intervient. Le trou est donc confirmé, pas seulement théorique.

**Correctifs recommandés :**
1. Retirer `users` du *payload* de synchronisation ; gérer les comptes uniquement via des endpoints dédiés (`/api/auth/users`) avec vérification `callerSession.role === 'manager'`.
2. Refuser côté serveur toute écriture de `role` / `password_hash` / `isActive` par le canal sync.
3. N'autoriser le push que pour un rôle `manager` (ou restreindre les tables financières au Gérant ; la caisse peut rester ouverte au Caissier).
4. Ajouter un test d'intégration « cashier cannot escalate » dans `src/test/`.

### 🔴 P0-2 — Secret de signature des jetons non déterministe en serverless

**Fichier :** `server/authEngine.ts:24-46` et `:100-106`.

Ordre de résolution du secret HMAC : `SALON_AUTH_SECRET` → paramètre de repli → `SALON_SYNC_PIN` → fichier `.salon-auth-secret` → **secret aléatoire en mémoire**.

Sur Vercel (système de fichiers en lecture seule), l'écriture du fichier échoue et chaque instance Lambda génère **un secret différent** : les jetons émis par une instance sont rejetés par une autre (`/api/sync` → 401 aléatoires), et un redéploiement déconnecte tout le monde.

**Correctifs :** exiger `SALON_AUTH_SECRET` au démarrage en production (erreur explicite si absent) ; refuser un secret < 32 caractères ; ne **jamais** utiliser `SALON_SYNC_PIN` comme clé HMAC (un PIN court est une clé faible).

### 🟠 P1-3 — RBAC purement côté client + données sensibles lisibles localement

Le routeur protège les écrans, mais IndexedDB contient paie, salaires, marges et hash de mots de passe. Un utilisateur « Caissier » peut lire/modifier ces données via les DevTools, et un appareil partagé conserve tout le contenu du salon. Le `register` local (`registerLocalUserAccount`) ne vérifie le rôle appelant que si un Gérant existe déjà en local : sur un navigateur vierge, n'importe qui peut créer un compte Gérant — sans conséquence tant que le serveur refuse le push, **sauf combiné à P0-1**.

**Correctifs :** chiffrement au repos (au minimum masquage des écrans non autorisés côté rendu), interdiction serveur du push de `users`, TTL de session plus court, et journalisation des connexions.

### 🟠 P1-4 — Authentification sans anti-bruteforce, hachage bloquant

- Aucune limitation de tentatives ni verrouillage sur `/api/auth/login` (`server/apiHandler.ts`).
- `pbkdf2Sync` (100 000 itérations, `server/authEngine.ts:60`) bloque la boucle d'événements Node ; chaque tentative coûte ~50-100 ms de CPU et gèle les autres requêtes.
- `loginUserOnNeon` charge **tous** les comptes puis exécute un PBKDF2 pour **chaque** candidat correspondant à l'identifiant (e-mail, nom complet **ou** téléphone) : un nom commun multiplie le coût.
- Mot de passe minimum : **6 caractères**, sans politique de complexité ni vérification de fuite.
- L'identifiant accepté inclut nom et téléphone → énumération de comptes plus facile.

**Correctifs :** `pbkdf2` asynchrone (`promisify`), index/déduplication de l'identifiant (un seul candidat), limitation par IP + e-mail (10 tentatives / 15 min), 8 caractères minimum, et séparation « identifiant de connexion = e-mail » vs recherche interne.

### 🟠 P1-5 — Jeton de session en `localStorage`

`AUTH_TOKEN_LOCAL_KEY` persiste 30 jours dans `localStorage` (option « se souvenir de moi ») : lisible par tout script injecté (XSS) et par toute extension. Alternative : cookie `HttpOnly; Secure; SameSite=Lax` posé par la fonction serverless — plus lourd dans cette architecture statique, mais plus sûr.

### 🟡 P2-6 — Fuite d'informations par les messages d'erreur

`formatDbError` renvoie `rawMsg` (message PostgreSQL brut) au client pour toute erreur non reconnue (`code: "SYNC_ERROR"`). Cela peut exposer noms de tables, contraintes, fragments de requête. → Journaliser côté serveur, renvoyer un identifiant de corrélation au client.

### 🟡 P2-7 — Autres observations

- **Bootstrap ouvert** : le premier inscrit devient Gérant sans validation. Sur une URL publique, quiconque arrive avant le propriétaire prend la main. → Ajouter un mécanisme d'invitation/bootstrap (`SALON_BOOTSTRAP_TOKEN`).
- **Aucune révocation** : jeton signé, TTL 30 jours, pas de liste noire ; désactiver un compte n'invalide pas ses jetons. Prévoir un `tokenVersion` par utilisateur.
- **Exports de sauvegarde** : `SALON_PRO_BACKUP_V1` contient `users` avec `passwordHash` → un fichier JSON de sauvegarde est un secret. À documenter, voire à expurger.
- **Absence de journal d'authentification** (succès/échec, IP) alors que l'application vante son « journal d'audit » métier.
- **Bonne nouvelle** : `verifyManagerPin` utilise `timingSafeEqual`, `verifyPasswordNode` aussi, le schéma SQL impose `email UNIQUE`, et `.env*`/`.salon-auth-secret` sont bien gitignorés.

---

## 7. Performance et scalabilité

| Constat | Référence | Impact |
|---|---|---|
| `readFullState()` relit **17 tables** après **chaque** mutation | `SalonStoreProvider.tsx` (`mutate`) | O(N) par clic ; sur 20 000 lignes, ~200-400 ms + sérialisation complète |
| Sync = envoi de **tout** l'état, puis 1 `INSERT` **par ligne** | `syncEngine.ts` (14 boucles séquentielles) | 5 000 recettes ⇒ ≈ 20 000 requêtes SQL par synchronisation |
| Debounce 1 600 ms après chaque mutation | `CloudSyncProvider.tsx:288` | Saisies rapprochées ⇒ synchronisations en rafale (atténué par `syncInFlightRef`) |
| Pull = `readFullCloudState()` complet + `get`/`put` par ligne côté client | `syncEngine.ts`, `mergeCloudSyncResult` | Latence réseau et CPU proportionnelles au volume total |
| Purge anti-fictif rejouée à chaque login et chaque sync, sur 14 tables | `authEngine.ts:314,443` | Latence de connexion et charge DB inutiles après la 1re fois |
| Limite de corps 15 Mo | `apiHandler.ts:67` | Plafond atteignable avec photos/années de données ; pas de compression |
| `pg.Pool` `max: 5` par instance Lambda | `neonClient.ts` | Risque de saturation des connexions Neon en charge (préférer `@neondatabase/serverless` en HTTP) |
| Bundle initial 534 kB (160 kB gzip) + `DashboardPage` 414 kB (recharts) | `vite build` | TTI dégradé en 3G ; avertissement Vite « chunks > 500 kB » |
| 2 950 lignes de CSS global + 92 variables | `styles/` | Pas de purge ; CSS mort probable avec le temps |

**Recommandations de scalabilité (par ordre de rentabilité) :**
1. **Sync incrémentale** : envoyer `since = lastSyncedAt` et ne pousser que les lignes modifiées ; côté serveur, `INSERT … SELECT * FROM unnest($1::jsonb[])` ou `COPY` pour batcher (divise par 10 à 50 le nombre d'aller-retours).
2. **`readFullState()` → `readChangedSince()`** après mutation, ou state manager granulaire (Zustand/TanStack Query) avec invalidation ciblée.
3. **Index** : ajouter `updated_at` en index sur les 14 tables métiers (indispensable au delta).
4. **Compression** (`Content-Encoding: gzip`) et `keepalive`/`AbortController` sur la requête de sync.
5. **Archivage** : sortir les exercices clos de l'état chargé en mémoire (`?year=`).
6. **Bundle** : `manualChunks` (recharts, framer-motion, lucide), chargement différé du graphique, `chunkSizeWarningLimit` justifié.

---

## 8. Qualité du code et maintenabilité

### 8.1 Points forts

- **TypeScript discipliné** : `verbatimModuleSyntax`, `noUnusedLocals/Parameters`, `erasableSyntaxOnly`, zéro `any` dans `src/server/api` (vérifié), zéro `console.*`, zéro `TODO/FIXME`, zéro `dangerouslySetInnerHTML`.
- **Domaine pur et testable** : `finance.ts` (1 061 lignes) regroupe caisse, commissions, paie, CUMP, budgets, alertes, diff d'audit → facile à tester unitairement (8 tests dédiés).
- **Nommage métier cohérent** en français, IDs préfixés (`cs_`, `cm_`, `tkt_`, `REC-…`, `sal_`, `corr_`) : le débogage terrain est simple.
- **Anti-double-soumission** intégré (`DuplicateSubmissionGuard` avec empreintes) : rare et précieux sur une app de caisse.
- **Design system cohérent** : 92 tokens CSS, thème clair/sombre, mouvement centralisé (`lib/motion.ts`) et respect de `prefers-reduced-motion`.

### 8.2 Dette technique

| Fichier | Lignes | Problème |
|---|---|---|
| `src/db/repositories/salonRepositories.ts` | **3 553** | Classe unique « Dieu » : caisse + tickets + paie + stock + users + sync + purge |
| `src/features/services/ServicesPage.tsx` | 1 775 | Écran monolithique, 15 `useState` |
| `src/features/payroll/PayrollPage.tsx` | 1 479 | Idem |
| `src/features/expenses/ExpensesPage.tsx` | 1 428 | Idem |
| `src/styles/global.css` | 2 950 | Styles non colocalisés, mélange inline/CSS |
| `src/components/checkout/CheckoutTicketModal.tsx` | 1 091 | Formulaire complexe sans bibliothèque de formulaires |
| `src/components/layout/CommandSearchModal.tsx` | 571 | Recherche globale réimplémentée à la main |

- **Duplication de composants** : `components/ui/*` (18 primitives maison), `components/patterns/c-*` (12 fichiers de patterns) et `components/reui/badge.tsx` coexistent avec deux `badge.tsx` distincts ; `components.json` (config shadcn) est présent mais **aucune dépendance Radix** n'est installée — les primitives (Select 427 l., Dropdown 375 l., Tabs 317 l.) sont réécrites à la main.
- **Pas de bibliothèque de formulaires ni de validation partagée client/serveur** (pas de `react-hook-form`, pas de `zod`) : chaque écran réimplémente état, erreurs, désactivation du bouton.
- **Pas de `ErrorBoundary`** : toute exception de rendu (ou `QuotaExceededError` Dexie) donne un écran blanc irrécupérable pour un utilisateur non technique.
- **Deux sources de vérité SQL** (`db/schema.sql` et `server/neonSchema.ts`) : identiques aujourd'hui, divergentes demain.

**Plan de découpage suggéré** (sans changer le comportement) : `repositories/` en `cashRepository`, `revenueRepository`, `payrollRepository`, `inventoryRepository`, `userRepository`, `syncRepository`, plus un `transactionRunner` commun ; et extraction des formulaires lourds en sous-composants (`TicketLineEditor`, `PayrollValidationPanel`, …).

---

## 9. Tests, CI/CD et exploitation

### 9.1 État actuel (49 tests, 11 fichiers, 35 s)

| Fichier | Tests | Ce qui est couvert |
|---|---|---|
| `calculations.test.ts` | 8 | Caisse, commissions, CUMP, budget, diff d'audit |
| `authFlows.test.tsx` | 5 | Inscription/connexion, rôles, repli local |
| `contextsAndBusinessFlows.test.tsx` | 5 | Contextes, flux caisse/ticket |
| `repositoryAndUi.test.tsx` | 8 | Dépôt + rendu des écrans, export CSV, ⌘K/audit |
| `neonSync.test.ts` | 5 | Sync avec faux pool, tombstones, purge, protection de `/api/sync` |
| `servicesConfig.test.tsx` | 2 | 3 modes de configuration, RBAC Gérant/Caissier |
| `reui*.test.tsx` + `motionElevation` | 17 | Patterns de présentation (smoke tests) |
| `setup.ts` | — | fake-indexeddb, jest-dom |

**Appréciation :** la base est saine (bonne utilisation de `fake-indexeddb` et de pools SQL simulés). Le serveur d'authentification **est** partiellement couvert (compatibilité PBKDF2 Node ↔ WebCrypto, `register`, `login`, `sync/verify` avec jeton) ainsi que la protection de `/api/sync` (401 sans jeton, `/api/health` sans secret). En revanche : **17 tests sur 49 portent sur la présentation**, la **paie, les rapports, le budget et l'inventaire** ne sont pratiquement pas testés, et **aucun test ne couvre le scénario d'escalade** décrit en P0-1. Aucune mesure de couverture n'est configurée.

### 9.2 Lacunes d'industrialisation

- **Aucune CI** (`.github/` absent) alors que `AGENTS.md` impose `npm run lint && npm test && npm run build` avant toute validation → la règle repose sur la discipline humaine.
- Aucun *pre-commit hook* (husky/lefthook), aucun `npm audit` en routine.
- Aucun test E2E (Playwright/Cypress) : les parcours critiques « ouvrir caisse → encaisser → clôturer », « payer un acompte » ne sont pas rejoués en navigateur réel.
- Aucun monitoring/erreurs (Sentry ou équivalent), aucune métrique d'usage, aucun *health check* exploité par une supervision.
- **`--reporter=basic` n'existe plus dans Vitest 4** (échec rencontré pendant l'audit) : utiliser `--reporter=default|dot` dans un éventuel script CI.

**Ajouts à coût quasi nul :** workflow GitHub Actions (lint + tests + build, cache npm), `vitest run --coverage` avec seuil, `npm audit --omit=dev` en alerte, et 3 scénarios Playwright sur les parcours caisse/paie.

---

## 10. UX, accessibilité, impression, PWA

**Points forts**
- Navigation par groupes métier (PILOTAGE / TRÉSORERIE / ACTIVITÉ / STOCK), barre mobile dédiée, ⌘K universel, actions rapides accessibles partout, alertes proactives cliquables avec deep-link.
- Impression soignée : reçus `80mm` / `A5`, rapport A4, bulletin de paie avec zones de signature, feuille `@media print` qui masque sidebar/topbar et gère `.print-only` / `.no-print`.
- Toasts avec `role="alert"` / `role="region"`, `aria-label` présents dans 38 fichiers, dropdown avec focus roving, `MotionConfig reducedMotion="user"`.

**Points à corriger**
- **Pas de *focus trap* ni de restitution du focus dans `Modal`** (`components/ui/Modal.tsx`) : le focus clavier reste derrière la modale ; pas d'`aria-labelledby` explicite (seulement `aria-label`).
- **Aucun lien d'évitement** (« aller au contenu »), pas de gestion du focus au changement de route (SPA) : lecteurs d'écran désorientés.
- **PWA incomplète** : `manifest.webmanifest` présent, mais **aucun service worker** → l'application ne se charge pas hors ligne (seules les *données* sont hors ligne). La promesse commerciale « hybride hors-ligne » n'est vraie qu'après un premier chargement réussi ; un cache `Workbox` serait nécessaire.
- Pas de mode d'emploi intégré ni de visite guidée pour un gérant non technicien (les libellés sont clairs, c'est déjà beaucoup).
- Thème sombre disponible et persisté (`salon_pro_ui_theme`), mais contrastes non vérifiés (WCAG AA) — audit axe-core recommandé.

---

## 11. Documentation et cohérence doc ↔ code

**Fort :** `README.md` est dense, structuré, orienté utilisateur (périmètre, configuration Neon, commandes) ; `AGENTS.md` énonce un contrat d'ingénierie clair (zéro mock, zéro secret en dur, validation obligatoire) — rare et appréciable.

**Incohérences relevées (à corriger, 10 minutes) :**
1. README §1 annonce « IndexedDB (**Dexie v2**) » alors que le code utilise `version(4)`.
2. README §3 documente `SALON_SYNC_PIN` dans `.env`, variable **absente** de `.env.example` (qui ne liste que `DATABASE_URL` et `SALON_AUTH_SECRET`), alors que le code lit bien `SALON_SYNC_PIN`.
3. README ne mentionne pas que `SALON_AUTH_SECRET` est **obligatoire en production** (sans lui, jetons invalidés entre instances — cf. P0-2).
4. Aucun document d'architecture (ADR), pas de `CHANGELOG`, pas de `CONTRIBUTING`, pas de contrat d'API (`/api/*`) documenté, pas de captures d'écran.

---

## 12. Registre des risques et plan d'action

### 12.1 Registre priorisé

| # | Sévérité | Risque | Fichier(s) | Effort |
|---|---|---|---|---|
| 1 | 🔴 P0 | Escalade de privilèges via `payload.users` (et écritures financières non contrôlées) | `server/syncEngine.ts:801-853`, `apiHandler.ts` | 0,5–1 j |
| 2 | 🔴 P0 | Secret HMAC non déterministe (serverless) ⇒ sessions cassées | `server/authEngine.ts:24-46,100-106` | 0,5 j |
| 3 | 🟠 P1 | Pas d'anti-bruteforce ; PBKDF2 synchrone ; mot de passe 6 caractères | `apiHandler.ts`, `authEngine.ts` | 1 j |
| 4 | 🟠 P1 | RBAC uniquement client ; paie/hash lisibles dans IndexedDB | `router.tsx`, `authContext.ts`, `database.ts` | 2–3 j |
| 5 | 🟠 P1 | Sync full-state O(N) requêtes ; pas de delta | `syncEngine.ts`, `salonRepositories.ts` | 3–5 j |
| 6 | 🟠 P1 | Numéros de reçu non uniques (réutilisation + collision multi-appareils) | `salonRepositories.ts:786` | 0,5 j |
| 7 | 🟠 P1 | LWW sur horloge client ; agrégats dérivés non réconciliés | `mergeCloudSyncResult`, `syncEngine` | 5–8 j |
| 8 | 🟠 P1 | Aucune CI alors que la règle est écrite | `.github/workflows` | 0,5 j |
| 9 | 🟠 P1 | Pas d'`ErrorBoundary` ⇒ écran blanc | `src/app/App.tsx` | 0,25 j |
| 10 | 🟡 P2 | Messages d'erreur SQL bruts renvoyés au client | `apiHandler.ts:formatDbError` | 0,25 j |
| 11 | 🟡 P2 | Jeton 30 j en `localStorage`, pas de révocation | `AuthProvider.tsx`, `authEngine.ts` | 1–2 j |
| 12 | 🟡 P2 | Pas de PWA réelle (aucun service worker) | `public/`, `vite.config.ts` | 1 j |
| 13 | 🟡 P2 | Bundle 534 kB / dashboard 414 kB | config Vite, imports | 0,5–1 j |
| 14 | 🟡 P2 | Fichiers monolithiques (3 553 l. repository) | `salonRepositories.ts` | 5–8 j |
| 15 | 🟡 P2 | Modale sans focus trap, pas de skip-link, contrastes non audités | `ui/Modal.tsx`, `MainLayout.tsx` | 1 j |
| 16 | 🟢 P3 | Doc : Dexie v2 / PIN / `SALON_AUTH_SECRET` | `README.md`, `.env.example` | 0,1 j |
| 17 | 🟢 P3 | Duplication DDL SQL (2 sources) et composants `ui`/`patterns`/`reui` | `db/`, `components/` | 2 j |
| 18 | 🟢 P3 | Pas de multi-tenant (si ambition SaaS) | schéma SQL | ≥ 15 j |

### 12.2 Feuille de route proposée

**Phase 0 — avant toute mise en ligne publique (1 à 2 jours)**
1. Retirer `users` du payload de sync + exiger le rôle `manager` pour le push des tables sensibles (P0-1).
2. Exiger `SALON_AUTH_SECRET` en production, jamais `SALON_SYNC_PIN` comme clé HMAC (P0-2).
3. `ErrorBoundary` global + message de secours Dexie (P1-9).
4. Unicité des reçus : `MAX(seq)+1` et contrainte `UNIQUE(receipt_number)` (P1-6).
5. Limitation des tentatives de connexion + PBKDF2 asynchrone (P1-3).
6. Corriger les trois incohérences de documentation (P3-16).

**Phase 1 — industrialisation (1 à 2 semaines)**
7. CI GitHub Actions (lint + tests + build, cache npm) et `--coverage` avec seuil.
8. Tests serveur : `authEngine` (inscription, refus, verrouillage), `/api/sync` (401/403, non-escalade), purge.
9. Rétention/masquage des jetons (cookie `HttpOnly` ou TTL court + `tokenVersion`).
10. Delta sync + index `updated_at` + batching SQL (P1-5) ; purge anti-fictif « une seule fois » (`dataHygieneVersion`).

**Phase 2 — robustesse produit (1 à 2 mois)**
11. Résolution de conflits par champ + réconciliation des agrégats dérivés (caisse, stock) et journal de résolution.
12. Service worker (Workbox) + découpage du bundle + `manualChunks`.
13. Accessibilité : focus trap des modales, skip-link, audit axe-core, contrastes.
14. Découpage du repository et des gros écrans ; introduction de `react-hook-form` + `zod` partagés client/serveur.
15. Observabilité : Sentry, journal d'authentification, métriques de sync.

**Phase 3 — si objectif SaaS**
16. Multi-tenant (`salon_id` partout, RLS PostgreSQL, jetons portant le tenant) ; sinon documenter explicitement « 1 déploiement = 1 salon ».

---

## 13. Verdict

**Ce que le projet fait très bien :** couvrir un métier réel avec une profondeur rare (tickets multi-lignes, paiements mixtes, avances et paie partielle, CUMP, charges récurrentes, budget avec run-rate, journal d'audit, alertes proactives), en respectant une discipline stricte sur la monnaie (FCFA entiers), avec un découpage domaine/persistance/UI honnête, une UX pensée pour le terrain (⌘K, actions rapides, impression thermique) et une exécution locale impeccable.

**Ce qui doit changer avant la production :** la synchronisation ne doit plus être un canal d'administration déguisé, le secret de session doit être stable et obligatoire, l'app doit résister à un écran blanc, et les numéros de reçus doivent être garantis uniques. Ces quatre chantiers représentent environ **deux jours** et font passer le projet d'un excellent prototype abouti à une application exploitable en salon réel.

**Ce qui limittera la croissance :** la synchronisation *full-state* ligne par ligne et le rechargement complet de l'état à chaque clic. Ce sont des choix cohérents pour 1 à 2 appareils et quelques milliers d'écritures ; ils deviennent le goulot d'étranglement au-delà de ~5 000 à 10 000 enregistrements ou de 3 utilisateurs simultanés.

---

## Annexe A — Reproduire l'audit

```bash
npm ci
npx oxlint                    # 0 warning / 0 erreur (103 fichiers)
npx vitest run                # 11 fichiers, 49 tests OK
npx tsc -b                    # OK
npx vite build                # OK (alertes chunks > 500 kB)
npm run dev                   # http://0.0.0.0:5173
curl -s localhost:5173/api/health
curl -s -X POST localhost:5173/api/sync -H 'Content-Type: application/json' -d '{}'   # 401
```

## Annexe B — Checklist avant mise en production

- [ ] `SALON_AUTH_SECRET` (≥ 32 car.) défini et **différent** de `SALON_SYNC_PIN`
- [ ] `DATABASE_URL` Neon avec `sslmode=require`
- [ ] Payload de sync sans `users` ; push réservé au rôle Gérant
- [ ] Contrainte `UNIQUE` sur `receipt_number` + séquence corrigée
- [ ] Limitation des tentatives de connexion active
- [ ] `ErrorBoundary` + message en cas d'échec IndexedDB
- [ ] CI verte (lint, tests, build) sur la branche de release
- [ ] Sauvegarde JSON exportée et testée en restauration
- [ ] Contrôle visuel mobile (390 px) et impression réelle 80 mm / A4
- [ ] Test de deux navigateurs simultanés (conflit LWW accepté et documenté)
