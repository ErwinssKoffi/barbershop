# PROMPT 00 — Résultats de baseline

Date : **1er novembre 2026**, fuseau Africa/Abidjan (UTC). Référence auditée : `e191a1d9235471bc937c6a2ca21a4060020d721f`, branche `arena/1bd00d86-barbershop`.

Voir le [rapport d’audit et plan d’intégration](00_REPOSITORY_AUDIT.md). Aucun développement fonctionnel, migration distante ou déploiement effectué.

## 1. Reproductibilité et état initial

- Node **v22.22.3**, npm **10.9.8** ; `package.json` demande Node `22.x`.
- `git status --short` initial : vide ; `git diff --check` : code 0. Aucun travail utilisateur non commité détecté au départ ; rien nettoyé/réinitialisé.
- `git log -5 --oneline` : seul commit local visible `e191a1d Add files via upload`.
- Playbook lu intégralement : 1 942 lignes. SHA-256 : `a9538c23b398c1a1e5fa6149fc06fa0a9b6c5382e52ad8d17430453d2f5db458`.
- Contrôle source distant **en lecture** : GitHub `main` = HEAD audité ; blob du playbook local/distant identique `01fab7991e3ef092f2e1848423c19fbeafca5317`.
- Dépendances installées avec **`npm ci`**, sans modification du manifeste/lockfile. Pas de mise à jour des dépendances ni de relèvement de timeout.

Les commandes suivantes ont été exécutées séparément et leur code de sortie collecté : un succès ultérieur ne masque pas l’échec de `db:check`.

## 2. Résultats frais

| Commande | Code | Résultat et limites |
|---|---:|---|
| `npm ci` | 0 | 188 packages ajoutés, 189 audités ; **0 vulnérabilité** signalée par npm à cet instant. Ce n’est pas un audit sécurité exhaustif. |
| `npm run db:schema:check` | 0 | `db/schema.sql` identique à l’export du registre 001–008. Vérification fichier, pas requête de catalogue hébergé ni migration. |
| `npm run lint` | 0 | **0 warning, 0 erreur**, 213 fichiers analysés, 116 règles. |
| `npm test` | 0 | **50 fichiers, 402 tests PASS** ; début 07:05:54 UTC ; durée **313,59 s**. Aucun test désactivé ni assertion retirée pour cet audit. |
| `npm run build` | 0 | `tsc -b && vite build` réussit ; build Vite 909 ms (hors compilation TypeScript). Avertissement de taille de chunks, voir ci-dessous. |
| `npm run db:check` | **1** | **BLOCKED — `missing_configuration`** ; aucune connexion DB disponible dans l’environnement local. Ni preuve d’indisponibilité de Supabase, ni preuve de schéma prêt. |
| `git diff --check` | 0 | Pas d’erreur d’espacement dans le diff suivi ; contrôle explicite des nouveaux rapports à ajouter au contrôle final puisqu’ils sont initialement non suivis. |

Sortie exacte de `db:check` :

```json
{"status":"missing_configuration","checkoutReady":false,"refundsReady":false}
```

Ces booléens **ne signifient pas** que 006/007 sont absentes à distance : aucun catalogue distant n’a été lu faute de configuration locale. Le contrat du check ne rapporte pas `bookingReady` ; il ne vérifie pas 008. Même `status=ready` n’aurait prouvé ici que le socle 001–005 selon le registre, pas l’ensemble des protections, le moteur booking ou une restauration.

### Garantie de lecture seule

Code inspecté : `server/checkDatabaseCli.ts` charge l’environnement privé, obtient le pool puis appelle `server/checkDatabase.ts`. Si un pool est disponible, celui-ci utilise **`BEGIN READ ONLY`**, timeout local et `SELECT` (test de connexion, existence du registre, IDs appliqués), puis COMMIT/ROLLBACK. Il n’appelle ni `ensureNeonSchema`, ni `runMigrations`, ni seed. Dans ce passage, l’absence de configuration a arrêté la vérification avant connexion. Aucune URI ou valeur secrète n’est copiée dans ce rapport.

### Avertissement build

Le bundle principal `dist/assets/index-BcaKHkUx.js` mesure **613,89 kB** minifié (**182,40 kB gzip**) ; Vite avertit pour les chunks > 500 kB. Le build reste PASS. À traiter dans l’analyse de performance du portail et la QA, sans augmenter artificiellement le seuil pour masquer l’avertissement. Aucun score Lighthouse, Core Web Vitals, navigation mobile ou accessibilité réelle mesuré ici.

## 3. Ce que la suite prouve / ne prouve pas

- `booking.test.ts` : migration 008 indépendante de 006/007, idempotence et conflit de clé, bornes adjacentes/chevauchements/blocages, versions et transitions, audit/rollback, isolation tenant, droits Gérant/Caissier, absence d’effet financier, module off et migration manquante.
- `bookingValidation.test.ts` : entrées invalides et concordance SQL 008/registre sans seed métier ; `bookingUi.test.tsx` : défaut off sans réseau, session capturée et contrôle de tenant/réponse périmée, affichage sur demande, droits Caissier, intention conservée après erreur réseau et changement de compte.
- `tenantIsolation.test.ts`, `sessions.test.ts`, `securityHardening.test.ts`, `accountWorkspace.test.tsx`, `localTenantSafety.test.ts` : socles sécurité/session/isolation locale et serveur. Ne pas interpréter la partition IndexedDB comme du chiffrement.
- Les suites caisse/refunds/rapprochement/sync/PWA sont le filet de non-régression existant. **Il n’y a pas encore de tests attestant les profils publics, les médias objet, les horaires récurrents, la réservation publique ou les abonnements SaaS**, absents de l’implémentation.
- `src/test/postgresTestPool.ts` utilise **PGlite/WASM**, moteur PostgreSQL embarqué avec rôles/RLS/contraintes, une même instance derrière les connexions de son adaptateur. Cela ne prouve **pas** des transactions réellement parallèles sur plusieurs connexions d’un PostgreSQL hébergé. Les tests de migrations comportent aussi un harness de contrôle de flux ; ils ne valent pas à eux seuls test du DDL réel.
- Les tests UI utilisent jsdom et des doubles réseau ; pas de navigateur E2E HTTPS, pas de deux appareils réels ni de preuve d’envoi de notification/paiement.

## 4. CI GitHub et hébergement : preuves séparées

Lecture actuelle via `gh run list --branch main` :

- [Validation du commit audité — run 41283237638](https://github.com/ErwinssKoffi/barbershop/actions/runs/41283237638) : **completed / success**, HEAD `e191a1d9235471bc937c6a2ca21a4060020d721f`.
- Le workflow `.github/workflows/` exécute installation, schema check, lint, tests et build. Ce workflow ne constitue pas un déploiement/restore/recette DB réelle.

Les documents `SUPABASE_SETUP.md`, `VERCEL_SETUP.md` et `docs/BOOKING.md` consignent historiquement : schéma privé 001–005 observé, migrations financières et booking volontaires non appliquées, projet Vercel préparé sans déploiement à la dernière observation, secrets sensibles Production présents à la dernière vérification sans déchiffrement. **Aucun de ces états Supabase/Vercel n’a été relu en live pendant cet audit**. Les paragraphes anciens disant « secrets absents », « lot non publié » ou donnant 338/373 tests sont historiques, pas l’état de cette baseline ; la dernière référence GitHub est bien auditée et verte.

Restent non établis : connexion Node → PostgreSQL dans l’environnement cible, catalogue/privilèges actuels, backup/restauration testée, déploiement et HTTPS réels, configuration Preview isolée, contrôle concurrent multi-connexion, recette multi-poste, supervision et rollback. Aucune démonstration ou ouverture d’API mutante n’a été utilisée pour vérifier ces points. Aucun Go production.

## 5. Artifacts et périmètre des changements

Logs temporaires locaux : `.cache/marketplace-audit/{install,schema,lint,tests,build,db-check}.log`. Ils ne sont pas des livrables versionnés et peuvent ne pas persister ; les sorties essentielles sont conservées dans ce rapport. `node_modules`, `dist` et les caches de build ne sont pas des modifications métier.

Seuls livrables ajoutés :

- `docs/marketplace/00_REPOSITORY_AUDIT.md` ;
- `docs/marketplace/00_BASELINE_RESULTS.md`.

Pas de module métier, dépendance, migration, snapshot, paramètre de déploiement, flag ou donnée modifié. Pas de secret demandé/exposé. Les ADR et l’architecture cible restent des livrables **futurs du PROMPT 01**, non entamé.

## 6. Contrôle final après rédaction

Deuxième passage complet après création des deux rapports, terminé à **07:19:47 UTC** : `db:schema:check` **0**, lint **0**, tests **0** (**402/402, 50 fichiers, 316,24 s**, début 07:14:28 UTC), build **0**, `git diff --check` **0**. Résultats identiques au premier passage ; aucun changement de code ni de paramètres de tests entre les deux. Logs supplémentaires : `.cache/marketplace-audit/final-{schema,lint,tests,build}.log`.

Les nouveaux rapports sont non suivis à ce stade : `git diff --check` seul ne les couvre pas. Contrôle explicite de leurs espaces de fin de ligne, fin de fichier et liens Markdown relatifs effectué séparément. Le code **1** de `git diff --no-index --check /dev/null <rapport>` sans diagnostic est le statut de différence attendu d’un fichier nouveau, pas une erreur d’espacement ; il n’est pas confondu avec l’échec DB.

`git status --short` final : uniquement `?? docs/marketplace/` contenant les deux rapports. Aucun fichier existant modifié, aucun commit/push ou déploiement effectué.

## 7. Verdict

- **PASS** : installation, cohérence du schéma généré, lint, 402 tests, build, CI GitHub de la référence.
- **BLOCKED** : contrôle DB runtime local (`missing_configuration`) ; validation hébergée et exploitation non acquises.
- **PARTIAL** : résultat global de la baseline, sans bloquer la revue documentaire des ADR ; **No-Go production**.

**PARTIAL**
