# Baseline — 31 octobre 2026

## Référence préservée

- Départ : `cecb99dc7b784072b9f7a4075d8f664772d96bf5` (fusion de la PR #2).
- Branche de travail existante dédiée : `arena/24f664e7-barbershop` ; pas de création/bascule vers une autre branche.
- Tag **local** annoté : `baseline/cahier-2026-10-31-cecb99d`, sur ce commit. Il n’a pas été poussé vers GitHub ; les références distantes n’ont pas été modifiées.
- Cahier original : `docs/reference/SALON_PRO_Cahier_des_charges_et_plan_refonte.md`, copié à l’identique. SHA-256 : `9c88e3ffc01e4a8bf80fc829c089232a60a5745d8d6c11abf3a1219e7f2dfce4`.
- Node exécuté : `v22.22.3`. `npm ci` : 188 paquets, audit npm sans vulnérabilité signalée à cette exécution (pas une garantie de sécurité complète).

## Mesures avant modification fonctionnelle

| Contrôle | Résultat observé |
|---|---|
| `npm run db:schema:check` | OK, parité snapshot ↔ migrations 001–005 |
| `npm run lint` | 0 erreur, 0 avertissement |
| `npm test` | **118/118**, 23 fichiers, environ 119 s |
| `npm run build` | TypeScript/Vite OK ; avertissement de chunk >500 kB non bloquant |
| `git diff --check` | OK |
| CI distante historique | Run `41169125235`, étape `npm test` en échec ; cause non déterminée. Ce run reste un échec, indépendamment de la baseline locale |
| Recette navigateur HTTPS / vraie concurrence DB | Non exécutée, pas présentée comme validée |
| Backup Supabase restauré et vérifié | **Non disponible / non vérifié**, donc pas de DDL distant dans ce sous-lot |

Les logs volumineux locaux sont temporaires et ignorés par Git. Ce rapport consigne les résultats, pas un export de données métier. Les fixtures anonymes des tests ne sont pas des seeds de l’application ni des copies de données clients.

## Inventaire et non-régression

- Schéma : `server/migrations.ts`, `db/schema.sql` généré, cinq migrations privées dans `supabase/migrations`.
- Secrets serveur documentés : `SUPABASE_DATABASE_URL` (prioritaire), `DATABASE_URL` (compatibilité), `SALON_AUTH_SECRET` ; aucun secret fourni ni ajouté.
- Déploiement conservé : Vite/Node en local, adaptateur API Vercel et PostgreSQL/Supabase privé en cible ; aucun accès DB direct navigateur.
- Flux et endpoints : [analyse des écarts](ANALYSE_ECARTS_CAHIER_DES_CHARGES.md), sections 4 et 5.
- Non-régression auth/comptes : `authFlows`, `securityHardening`, `sessions`, `sessionClient`.
- Non-régression tenant : `tenantIsolation`, `localTenantSafety`, `accountWorkspace`.
- Non-régression sync/stock : `neonSync`, `deltaSync`, `cashierStock`.
- Non-régression métier/UI : `calculations`, `repositoryAndUi`, `contextsAndBusinessFlows`, `servicesConfig` et autres tests existants ; ne pas supprimer ces tests pour masquer une régression.
- PWA : `pwa`, `pwaStatus`, procédure `PWA_TESTING.md` ; installation OS non prouvée par Vitest.

## Retour arrière et précautions

Le présent sous-lot n’introduit aucune migration ni écriture financière dans sa nouvelle route. Retour arrière applicatif possible en redéployant le commit de référence, après arrêt propre des anciens clients et vérification du worker/PWA. Il ne faut ni supprimer les bases Dexie ni remettre une base PostgreSQL à zéro pour revenir au code précédent. Les données historiques ne sont pas modifiées par le changement de libellés local/provisoire.

Avant le futur lot de persistance 006+ : sauvegarde privée du schéma et des données avec un moyen autorisé de l’hébergement, contrôle de fin d’export, restauration sur une base isolée, contrôle des comptes/tenants/recettes/tombstones/journal, puis exercice du parcours de connexion et d’une vente. Conserver la preuve de restauration et la procédure de redéploiement compatible. Ne pas déposer un dump réel, une URI ou un secret dans Git. Une sauvegarde demandée mais non restaurée ne remplit pas cette porte.

## Validation après ce sous-lot

- `npm run db:schema:check`, `npm run lint`, `npm test`, `npm run build`, `git diff --check` : **OK**.
- **137/137 tests, 24 fichiers**, environ 131 s ; 19 nouveaux cas de contrat/API et assertions de projection/UI complétées.
- Lint : 0 erreur, 0 avertissement. Build TypeScript/Vite réussi ; avertissement de chunk volumineux toujours ouvert.
- Aucun nouveau SQL/migration, aucune connexion de production modifiée, aucune écriture financière effectuée par le nouveau devis.
- Les contrôles CI distants, sauvegarde/restauration et recette multi-postes HTTPS ne sont pas marqués comme réussis par ces tests locaux.

## Validation après lot 1b

31 octobre 2026 : `npm run db:schema:check`, `npm run lint`, `npm run build`, `npm test`, `git diff --check` réussis après implémentation du commit. **147/147 tests, 25 fichiers**, lint sans erreur/avertissement. Régression 005 sans migration checkout et tests PostgreSQL/RLS 006 volontaire inclus ; aucune donnée métier de test persistée hors des bases embarquées jetables. Le build conserve l’avertissement de taille de chunk, les tests UI les avertissements graphiques JSDOM connus.

Le snapshot inclut 006 mais le démarrage/CLI par défaut restent à 005. Ni migration distante ni backup/restore ni vraie concurrence multi-connexion ni nouvelle validation CI GitHub dans ce lot. Le tag baseline reste celui du code de départ ; il n’est pas déplacé vers ce travail non committé.

## Validation après lot 1c (pilote optionnel)

31 octobre 2026 : schéma, lint (0 erreur/avertissement), build, **169/169 tests / 28 fichiers** et diff vérifiés. Inclut v5→v6 IndexedDB non destructive, file/retry/baux/scopes, UI des deux rôles et intégration PostgreSQL avec réponse perdue puis rejeu ancien après une autre vente. Aucune nouvelle recette CI GitHub/HTTPS hébergée ni vraie concurrence PostgreSQL multi-connexion. Drapeau frontend pilote désactivé par défaut ; aucune migration hébergée exécutée. Avertissements graphiques JSDOM et taille de chunk non bloquants inchangés.

## Validation après lot 1d (récupération et supervision)

31 octobre 2026 : `npm ci` réussi (188 paquets, audit 0 vulnérabilité), schéma à jour, lint 0 erreur/avertissement, build et **190/190 tests / 31 fichiers** réussis, `git diff --check` OK. Route status sans effets financiers, export/restauration atomique en suspension, reprise explicite et UI filtrée/paginée couverts. Avertissements React act asynchrones dans les nouveaux tests UI non bloquants, en plus des avertissements graphiques et chunk déjà connus. Aucun DDL distant, aucune recette HTTPS/multi-connexion ou CI GitHub nouvelle. La récupération locale testée ne constitue pas une restauration PostgreSQL hébergée.

## Validation après lot 1e (bascule volontaire)

31 octobre 2026 : installation npm ci (188 paquets, audit 0 vulnérabilité), schéma/lint/build/diff OK, passe complète finale **210 tests / 35 fichiers**, sortie 0. Les premières passes complètes ont donné 206/210 puis 209/210 puis 209/210, sur des attentes de démarrage : PostgreSQL embarqué froid >5 s et première transformation du Dashboard au-delà du délai UI. Les cas ciblés repassaient sans changement des assertions. Le moteur WASM est maintenant préchauffé dans une base jetable fermée en beforeAll (budget setup 15 s), et le vrai module Dashboard importé en setup du parcours auth. Les bases métier restent isolées par test, aucune assertion n’est supprimée, les budgets des assertions restent ceux d’origine. Dernière suite complète verte ; la cause de la CI historique reste non établie et aucun run GitHub nouveau n’est revendiqué.

Variables serveur de bascule et pilote désactivés par défaut. Aucun DDL distant ni sauvegarde/restauration hébergée prouvée. Limites du prévol, autres voies financières et procédure opérateur détaillées dans CHECKOUT_SERVEUR.md. Avertissements React act/graphiques JSDOM/chunk non bloquants connus.

## Validation locale après lot 2a

221/221 tests, 36 fichiers, 219,54 s ; lint/build/schema/diff verts. Journal `.cache-refund-validated-tests.log`. Ajout des remboursements intégraux serveur et de 007 strictement optionnelle ; aucune sauvegarde/restauration hébergée ni activation n'est démontrée par cette validation locale. Voir le contrat du lot 2a dans CHECKOUT_SERVEUR.md. Production No-Go maintenue.

## Validation locale après lot 2b

234/234 tests, 37 fichiers, 209,58 s (`.cache-refund-ui-full-tests.log`) ; lint zéro avertissement/erreur, build/schema/diff verts. Interface Gérant et reprise manuelle durable du remboursement ajoutées. Pas de worker, d'avoir imprimable, d'export remboursement ni de recherche multi-poste. Migrations hébergées et garanties de sauvegarde/restauration inchangées : No-Go production.

## Validation locale après lot 2c

256/256 tests, 38 fichiers, 219,56 s (`.cache-refund-print-full-tests.log`) ; lint sans avertissement/erreur, build/schema/diff verts. Avoir imprimable depuis le seul remboursement confirmé cohérent, portail isolé et tests de réimpression sans mutation. Impression réelle/pagination multi-navigateurs et conformité fiscale non validées ; aucun changement des portes de sauvegarde/restauration ni activation hébergée. No-Go production maintenu.

## Validation locale après lot 2d

278/278 tests, 39 fichiers, 215,99 s (`.cache-refund-recovery-full-tests.log`) ; lint zéro avertissement/erreur et build/schema/diff verts. Export/import dédié des intentions de remboursement, strictement même compte/espace, restauration atomique en vérification seule et récupération de l'avoir après vrai statut API. Aucun renvoi d'une intention importée, même après `not_found`. Aucun changement des portes de sauvegarde/restauration de la base hébergée ni activation. Production No-Go maintenue.

## Validation locale après lot 2e

294/294 tests, 39 fichiers, 232,60 s (`.cache-refund-resume-full-tests.log`) ; lint sans avertissement/erreur et build/schema/diff verts. Reprise des intentions importées uniquement après absence authentifiée, contrôle canonique, confirmation explicite et comparaison serveur des préconditions sous verrou. Fonds/droits revalidés à l'exécution, réponse perdue récupérée sans seconde écriture dans le test intégré. Aucune nouvelle migration ou activation hébergée ; sauvegarde/restauration PostgreSQL et recette matérielle restent non démontrées. Production No-Go maintenue.

## Validation locale après lot 2f

317/317 tests, 41 fichiers, 247,22 s (`.cache-checkout-history-full-tests.log`) ; lint sans avertissement/erreur, build/schema/diff verts. Recherche/consultation Gérant des tickets canoniques multi-postes en lecture seule, pagination à précision microseconde et préparation depuis un espace sans vente locale. Aucune nouvelle migration ni activation hébergée. Gros volumes, impression physique et sauvegarde/restauration PostgreSQL restent non démontrés : No-Go production maintenu.

## Validation locale après lot 2g-a

327/327 tests, 41 fichiers, 254,10 s (`.cache-refund-diagnostic-validated-tests.log`) ; lint zéro avertissement/erreur et build/schema/diff verts. Diagnostic des intentions bloquées sans correction, mutation ni autorisation de renvoi. Aperçu dev sur 4173 vérifié HTTP 200 ; health indique `databaseConfigured:false`, donc pas de validation Cloud en fonctionnement dans cet aperçu. Aucune migration ou activation hébergée : No-Go production maintenu.

## Validation après correctif de chargement serveur

333/333 tests, 42 fichiers, 245,84 s (`.cache-server-config-full-tests.log`), lint/build/schema/diff verts. Chargeur privé `.env.local`/modes et commande `db:check` READ ONLY ajoutés. Vérification du connecteur Supabase : 001–005 présentes, aucun DDL/DML distant. `db:check` local reste en `missing_configuration` ; connexion réelle non démontrée (URI privée et accès réseau PostgreSQL nécessaires). Ce correctif ne lève pas le No-Go.
