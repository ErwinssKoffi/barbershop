# PROMPT 02 — Tranche 02A : fondation des profils publics

Date : 1er novembre 2026. Branche : `arena/1bd00d86-barbershop`.

## Autorisation et périmètre

Après l’audit, l’architecture et la décision explicite de conserver React/Vite, l’utilisateur a autorisé le démarrage de l’implémentation. Ce lot met en œuvre **uniquement une première tranche locale du PROMPT 02**, sur les frontières profil privé/public des ADR-002/006. Ce n’est ni l’ensemble du modèle cible ni une autorisation d’achat, de publication ou de DDL distant. Les autres décisions commerciales/fournisseurs et les détails SSR restent ouverts.

**Réalisé :** migration additive opt-in 009, snapshot généré, types/DTO allowlist, tests SQL/RLS et garde CLI. **Non réalisé :** interface Visibilité, API publique/privée de profil, upload média, horaires, services publics, nouvelle réservation, notification, abonnement, paiement ou portail SSR. L’ERP reste React/Vite ; aucun Next.js ni autre dépendance n’est ajouté.

Les migrations 001–008, le moteur booking, les tables financières, les comptes, les purges et tombstones ne sont pas réécrits. Le socle fonctionne avec 001–005, sans installer booking/checkout/refunds. Aucun accès Supabase navigateur n’est ajouté.

## 1. Fichiers et modèle

- `server/marketplaceSchema.ts` : source SQL 009.
- `supabase/optional/009_marketplace_profiles.sql` : SQL aligné sur cette source, dans la convention des migrations volontaires.
- `server/migrations.ts` : registre et option **`includeMarketplace`**, false par défaut ; aucune migration sur requête API.
- `server/exportSchema.ts` / `db/schema.sql` : snapshot généré incluant les optionnelles, jamais un script à appliquer en bloc.
- `server/migrationOptions.ts`, `server/migrate.ts` : `--include-marketplace` exige l’approbation privée `SALON_MARKETPLACE_BACKUP_VERIFIED=true`.
- `src/domain/marketplace.ts` : types de brouillon/ligne publiée et `PublicSalonProfileV1`, sérialisation explicite sans IDs internes.
- `src/test/marketplaceSchema.test.ts`, `src/test/migrations.test.ts` : preuve locale et contrôle du mécanisme opt-in.

| Table | Rôle et contraintes |
|---|---|
| `salon_public_profiles` | Brouillon, une fiche par tenant, PK `(tenant_id,id)`, version positive, champs texte bornés, coordonnées explicitement destinées au public mais encore privées avant publication |
| `salon_public_visibility` | Gate tenant/profil, FK composite, fermé par défaut, publication + activité tenant + période explicite requises ; autorisation sans période = aucune visibilité |
| `salon_public_projection` | Révision publiée indépendante du brouillon ; FK composite vers gate, slug global unique/normalisé, champs publics explicites uniquement |
| `salon_public_profile_events` | Audit append-only, FK composite profil et membership acteur, type/version bornés, trigger rejetant UPDATE/DELETE même privilégiés tant qu’il est actif |

Dates en `timestamptz`. Aucun montant dans cette tranche ; les futurs prix devront être des entiers XOF. Aucune ligne métier insérée par la migration. Aucun profil existant ni logo privé copié automatiquement. Pas de table `appointments` concurrente de `bookings`.

## 2. Sécurité et publication fermée par défaut

Toutes les nouvelles tables ont **ENABLE + FORCE RLS** et une politique tenant-scoped pour les lectures runtime. Brouillons modifiables et événements insérables sous contexte tenant ; pas de DELETE runtime. Les permissions Gérant/Caissier seront vérifiées dans les futures commandes API : le rôle SQL runtime partagé ne remplace pas cette autorisation utilisateur.

Le runtime possède seulement **SELECT** sur gate/projection : il ne peut pas publier en modifiant directement une colonne. Il faudra en phase 03 une commande de publication auditée et des permissions dédiées minimales, après vérification d’entitlements ; aucun endpoint public ne contourne ce verrou actuellement.

Un rôle serveur lecteur dédié par schéma (`salon_pro_public_<hash>`) est NOLOGIN, NOSUPERUSER, NOBYPASSRLS et NOINHERIT. La migration refuse **tout rôle lecteur préexistant**, même avec attributs sûrs : il pourrait déjà posséder des grants privés. Elle ne le modifie ni ne le réutilise silencieusement. Il ne lit que gate et projection soumis à policy ; aucun droit sur brouillons/événements, comptes, employés, revenus ou memberships. PUBLIC/anon/authenticated n’ont aucun privilège nouveau, même en présence de defaults de grants défavorables sur les nouvelles tables. La connexion serveur autorisée doit activer ce rôle dans une transaction en lecture ; aucune connexion navigateur directe n’est fournie.

Le lecteur voit les profils **à travers les tenants**, mais seulement lorsqu’un gate publié/actif couvre `CURRENT_TIMESTAMP`. Le mapping tenant/profil reste interne ; le DTO n’expose que slug, nom, description, localisation consentie, téléphone public facultatif et révision. Le mapper n’est pas une autorisation : son entrée doit provenir de cette lecture filtrée, jamais du brouillon.

Deux triggers sûrs sur l’activité tenant dérivent l’état depuis `tenants` et ferment le gate dans la transaction de suspension. Réactiver un tenant **ne republie pas automatiquement**. Fonctions trigger avec `search_path=pg_catalog`, identifiants de schéma quotés via `format('%I',TG_TABLE_SCHEMA)`, EXECUTE révoqué de PUBLIC. Pas de fonction publique SECURITY DEFINER lisant les tables financières.

**Limite volontaire :** `allowed_from/until` ne sont pas une souscription ni une preuve de paiement. Aucun gestionnaire commercial n’est implémenté. Le futur service de droits devra mettre à jour les gates atomiquement sur changements de droits ; en attendant, aucune route runtime ne peut ouvrir un gate. Les tests créent des autorisations via leur connexion privilégiée isolée, pas via un seed ou une activation réelle.

## 3. Application locale et interdictions distantes

Pour les tests uniquement, `runMigrations(poolDeTest, {includeMarketplace:true})` utilise PGlite éphémère. Les commandes de l’application restent sur 001–005 par défaut ; ni `ensureNeonSchema` ni le build n’optent pour 009.

Ne pas exécuter `db:migrate -- --include-marketplace` contre une base réelle dans ce lot. Le flag de backup est un **garde d’approbation**, pas une sauvegarde, ni une preuve de restauration. Aucune valeur de ce flag n’est créée ici.

Avant toute application distante future :

1. Identifier l’environnement et la référence déployée ; inventorier registre actuel, privilèges et données, en lecture.
2. Obtenir une sauvegarde complète PostgreSQL et prouver sa restauration dans un environnement isolé, avec RPO/RTO documentés ; l’export Dexie ne contient pas bookings ni nouvelles tables serveur.
3. Contrôler les defaults/grants et schéma privé `salon_pro`, rôle de migration vs runtime, et existence/état des rôles avant DDL.
4. Valider la durée/verrouillage sur copie restaurée, permissions, triggers et compatibilité de l’ancien binaire.
5. Autorisation explicite de migration, puis vérification en lecture du catalogue et des accès. Pas d’application aveugle de `db/schema.sql` ni de SQL optionnel dans `public`.

**BLOCKED distant :** aucune preuve de restauration hébergée n’est disponible pour ce lot. Aucun DDL, objet, compte, secret, flag ou donnée hébergée modifié.

## 4. Rollback et récupération

- Avant application : l’option false laisse le système inchangé ; ne pas installer 009 suffit. Les tests vérifient opt-in et non-réapplication.
- En cas d’échec de la migration : transaction complète annulée, tables/policies/fonctions/registre 009 absents ; rôle dangereux préexistant conservé pour diagnostic, pas modifié silencieusement. Les migrations déjà appliquées restent enregistrées.
- Après succès : rollback applicatif vers l’ERP compatible, en **conservant** les tables/événements/registre et le rôle restreint. Aucun endpoint public n’est ajouté à couper dans ce lot. Un retour binaire n’a pas besoin de DROP.
- Si retrait SQL devenu indispensable : opération distincte sur copie restaurée, inventaire des dépendances et éventuelles nouvelles données, export/backup et autorisation explicite ; aucun down destructeur automatique fourni. Ne pas supprimer les événements ni les données réelles pour satisfaire un rollback.
- Ne pas restaurer en place une vieille sauvegarde qui écraserait les opérations financières survenues depuis ; procédure de restauration/réconciliation à valider avant DDL réel.

## 5. Validation et limites de preuve

Validation finale, terminée le 1er novembre 2026 à **08:02:45 UTC** :

| Commande | Code | Résultat |
|---|---:|---|
| `npm run db:schema:check` | 0 | Snapshot généré cohérent, source SQL optionnelle vérifiée par test |
| `npm run lint` | 0 | **0 erreur, 0 warning**, 217 fichiers |
| `npm test` | 0 | **420/420 tests, 51 fichiers**, début 07:56:57 UTC, durée **344,10 s** |
| `npm run build` | 0 | Compilation TypeScript et Vite OK, build Vite 961 ms hors TypeScript |
| `git diff --check` | 0 | Pas d’erreur d’espacement dans les fichiers suivis ; nouveaux fichiers contrôlés séparément |
| `npm run db:check` (07:55 UTC, lecture seule) | **1** | `missing_configuration`, `checkoutReady:false`, `refundsReady:false` ; pas de connexion ou inventaire distant prouvé |

Avertissement build existant maintenu : bundle principal 613,89 kB minifié / 182,40 kB gzip, au-dessus du seuil 500 kB. Ce n’est pas une régression de bundle introduite par le lot. Aucun timeout relevé, test désactivé ou assertion retirée.

Tests ciblés finaux : **24/24**, dont 17 scénarios de fondation et 7 de registre, sur PostgreSQL embarqué PGlite (33,08 s). La revue a renforcé le refus de réutilisation de rôle et la révocation des defaults EXECUTE navigateur. Un passage complet intermédiaire à 419 tests était vert avant ce dernier durcissement ; le résultat final est bien **420**, avec les 402 tests historiques conservés.

Logs temporaires non versionnés : `.cache/marketplace-02-final/{schema,lint,tests,build}.log`, `.cache/marketplace-02/db-check.log` et `.cache/marketplace-02-targeted-final.log`. Ils ne remplacent pas les sorties essentielles conservées ici et peuvent ne pas persister. Aucun commit/push, migration distante ou déploiement effectué.

Couverture : isolation lecture/mutation sans contexte et cross-tenant, quatre tables FORCE RLS, FK composites profil/acteur, brouillons jamais lisibles par le rôle public, révision publiée indépendante, gate fermé sans droits explicites/futur/expiré, suspension atomique/réactivation prudente, grants navigateur révoqués, runtime sans publication, audit append-only, DTO filtré, opt-in/backup guard, migration depuis 001–008 sans altérer bookings/comptes, refus de rôle dangereux et rollback transactionnel.

`db:check` et `cloud:check` existants ne constituent pas un diagnostic de préparation de 009 ; ils ne sont pas étendus dans ce lot.

Ce n’est **pas** une preuve PostgreSQL multi-connexion, E2E HTTPS, publication effective, abonnement ni SEO SSR. Aucune concurrence de réservation ajoutée ou revendiquée. Les snapshots historiques de 402 tests restent historiques ; ils ne remplacent pas le passage complet de ce lot.

## 6. Suite séquentielle

Compléter le socle des autres tranches de 02 selon besoins validés (services publics/horaires/médias, puis évolution de 008 et données SaaS/outbox uniquement lorsqu’utiles), avec nouveaux IDs additifs et tests ; ne pas réécrire 009 après application. La phase 03 apportera les commandes API/UI de Visibilité avec permissions utilisateur et audit dans la transaction. Aucun écran n’est réputé livré par ces tables.

**PARTIAL — tranche 02A locale, pas la totalité du PROMPT 02 ; No-Go production maintenu.**
