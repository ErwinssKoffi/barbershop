# PROMPT 02 — Tranche 02C : prestations publiques et règles de réservation

Date : 1er novembre 2026. Branche : `arena/1bd00d86-barbershop`.

Suite demandée explicitement après [02A](02_DATA_FOUNDATION.md) et [02B](02B_SCHEDULING_FOUNDATION.md). React/TypeScript/Vite conservés. **Implémentation du modèle, de ses protections SQL et de la logique de domaine** ; pas encore d’API, interface, publication effective ou réservation publique. Les tableaux/fixtures ne sont pas des seeds runtime.

## 1. Catalogue relié aux données authentiques

Migration volontaire **011_public_catalog** :

| Table | Rôle |
|---|---|
| `salon_public_services` | Sélection privée de prestations/variantes existantes, nom/description publics, demande de réservation, version |
| `salon_public_service_projection` | Snapshot publié : ID opaque d’offre, prix XOF, durée, provenance/version source, disponibilité dérivée, révision |
| `salon_booking_rules` | Règles privées explicitement renseignées, sans configuration commerciale automatique |
| `salon_public_booking_rules` | Copie publiée séparée et rattachée au profil public |

Sources : `server/publicCatalogSchema.ts`, `supabase/optional/011_public_catalog.sql`. `db/schema.sql` est régénéré depuis le registre, pas modifié à la main. Toutes les tables portent ENABLE + FORCE RLS, FK tenant-composites, bornes de taille et versions positives.

Le source est `services_catalog` du **même tenant**. Une variante doit appartenir à cette prestation JSON, vérifiée au niveau SQL sur le brouillon ; la disponibilité publiée vérifie aussi son existence. Une seule offre de base et une offre par variante/source/tenant, y compris l’unicité du cas sans variante (`UNIQUE NULLS NOT DISTINCT`, PostgreSQL 15+ ; moteur actuel PostgreSQL embarqué compatible).

`deriveServicePublication()` dans `src/domain/publicCatalog.ts` dérive **uniquement depuis un modèle catalogue relu côté serveur** : prix de référence ou prix de la variante, durée de variante ou durée de prestation. Source inactive, variante absente/ambiguë, prix non entier/négatif/non sûr et durée incorrecte refusés. Une durée manquante autorise une fiche informative non réservable, pas une durée inventée. Durées réservables 5–480 minutes, compatibles avec la limite actuelle de booking 008 ; le relèvement éventuel exige une évolution coordonnée.

Aucun consommable, commission, coût de revient ou autre donnée privée n’est repris dans le DTO. Prix stockés en BIGINT XOF entre 0 et `Number.MAX_SAFE_INTEGER`. Le futur adaptateur SQL devra convertir explicitement les BIGINT retournés en texte par `pg` et valider les entiers avant DTO ; aucune ligne SQL brute ne doit être sérialisée.

**Pas de copie automatique** des prestations ERP vers le public. Aucun prix, prestation, variante, forfait ou contact fictif créé. Un futur endpoint devra relire la source privée, contrôler utilisateur/droits et appeler le constructeur : cette fonction seule n’authentifie pas un objet provenant d’un navigateur.

## 2. Invalidation et suppression sans casser les purges

Le lecteur public n’a aucun SELECT du catalogue privé. La projection stocke un état technique `source_available`, validé par trigger à partir de l’activité réelle, du payload, de la variante et du `updated_at` source. Le caller ne peut pas rendre disponible une source inactive ou périmée en passant simplement `true`.

**Tout changement effectif de la ligne catalogue** ferme la visibilité de ses offres dans la même transaction, même si le timestamp n’a pas été changé. Cela inclut les changements privés (par exemple commission) : compromis volontairement conservateur, une republication explicite sera nécessaire. Réactiver une source ne republie jamais automatiquement. Une édition de texte du brouillon public ne réécrit pas la version publiée.

La suppression d’une source par le chemin existant provoque CASCADE **uniquement des sélections/projections publiques dérivées**, et pas un refus de purge par une nouvelle FK restrictive. Les vrais comptes, écritures financières et tombstones existants ne sont ni modifiés ni supprimés par 011. Les futurs rendez-vous devront conserver des snapshots historiques et ne pas dépendre de ces lignes de catalogue supprimables ; aucune FK booking→offre vivante n’est introduite ici.

Fonctions trigger à `search_path=pg_catalog`, accès privé limité par clés tenant/source et schéma quoté issu de `TG_TABLE_SCHEMA`. Fonctions de dérivation/invalidation SECURITY DEFINER non exécutables par PUBLIC/anon/authenticated ; propriétaire et droits de migration à vérifier sur le runtime hébergé avant DDL. Aucun accès SQL anonyme au métier.

## 3. Règles explicites et comportements implémentés

Aucune ligne de règles n’est créée par défaut. Les champs suivants doivent tous être renseignés : activation online, pas de créneau, délai minimum, horizon, marges avant/après, autorisation et délai d’annulation, choix employé, révision.

| Règle | Sémantique de domaine |
|---|---|
| `onlineBookingEnabled` | Désactive l’éligibilité des nouvelles réservations ; ne bloque pas à lui seul l’annulation d’un RDV existant |
| `slotStepMinutes` | Pas de 1 à 1440 minutes ; grille ancrée à minuit local, pas au début de chaque ouverture |
| `minimumNoticeMinutes` | Délai minimum inclusif entre instants UTC canoniques ; entier non négatif |
| `horizonDays` | Nombre positif de jours calendaires locaux à partir d’aujourd’hui au salon ; borne incluse, pas une multiplication naïve d’instants par 24h pour le DST |
| `bufferBeforeMinutes` / `bufferAfterMinutes` | Marges explicites, 0–1440 minutes ; prestation et marges doivent tenir dans **la même** fenêtre ouverte, sans traverser une pause |
| `cancellationAllowed` / `cancellationNoticeMinutes` | Autorisation et cutoff inclusif avant début ; la validation de capacité et de statut du RDV reste à ajouter dans la commande |
| `employeeChoiceAllowed` | Politique stockée/validée/projetée ; pas encore d’affectation d’employé ou de moteur de ressources |

`parseBookingRules` refuse champs inconnus, types faux, politiques manquantes, valeurs non entières/hors bornes ; **pas de valeurs commerciales implicites**. Les limites de taille des entiers et de la journée sont des limites techniques, pas des durées d’essai ou tarifs proposés.

`serviceFitsOpeningWindow()` vérifie grille, durée et marges sur les fenêtres locales normalisées de 02B ; une fermeture exceptionnelle s’obtient d’abord via `openingWindowsForDate()`. `bookingWithinPolicy()` vérifie notice UTC et horizon de dates locales ; les dates locales doivent être dérivées par le serveur à partir du fuseau salon, jamais crues si fournies par le navigateur. `cancellationWithinPolicy()` n’effectue ni vérification d’identité ni mutation de RDV.

Le DTO d’une prestation marque `bookable` seulement si le flag serveur passé explicitement, les règles publiées actives, l’intention de l’offre et une durée valide sont réunis. **Ce booléen n’est pas une garantie de créneau libre**, ni une autorisation SQL. La future API devra également vérifier entitlement, horaires publiés, fuseau/DST, ressource active, collisions, limites anti-abus et revalidation transactionnelle. Le flag n’est pas créé/activé dans ce lot.

## 4. RLS et publication encore verrouillée

Runtime privé : CRUD des brouillons et règles de son tenant, SELECT de ses copies publiées ; aucune écriture directe des projections. Les futures commandes devront contrôler le rôle Gérant, la session et membership, version attendue, entitlement et audit ; la RLS ne distingue pas à elle seule les Gérant/Caissier utilisant le même rôle SQL.

Lecteur serveur public : SELECT des deux projections seulement. Les policies imposent le profil visible de 009 et, pour les prestations, une source disponible. Brouillons, source privée, revenus/employés restent illisibles. Dépublication/expiration/suspension du profil masquent prestations et règles via la policy du parent. Aucune permission navigateur, même face à des grants par défaut défavorables.

Les fonctions DTO sélectionnent les champs publics explicitement. Les identifiants de source/tenant, timestamps techniques, notes et commissions ne sont jamais inclus dans leur sortie. Les identifiants opaques d’offre ne donnent pas de droit de lecture directe SQL.

Aucun rôle de publication ni endpoint n’est ajouté. Les tests utilisent une connexion propriétaire de leur base éphémère pour créer leurs projections ; ce n’est pas un parcours Gérant déjà livré. Les règles/statuts/prix ne peuvent être imposés par une requête publique puisqu’aucune route de ce type n’existe encore.

## 5. Opt-in, migration et rollback

- Option dédiée **`includePublicCatalog` / `--include-public-catalog`** : implique 009 et 011, **pas 010, booking 008 ou finance 006/007**. On peut publier un catalogue informatif sans horaires ; le futur booking nécessitera les deux socles et ses autres prérequis.
- `--include-marketplace` reste 009 seulement, `--include-scheduling` reste 009+010. Pas d’extension silencieuse des anciens opt-ins.
- Garde privé inchangé : `SALON_MARKETPLACE_BACKUP_VERIFIED=true` requis pour l’opt-in CLI. Ce flag ne constitue pas une preuve de backup/restore. Aucun `db:migrate` réel exécuté dans ce lot.
- SQL source/export 009/010 inchangés, contrôlés par hashes avant/après. Migrations 001–008 et moteur booking financier non réécrits. Aucune dépendance/npm framework ajouté.
- Échec de 011 : rollback transactionnel tables, triggers/fonctions et registre ; 009/010 déjà appliquées restent intactes. Test d’un échec SQL après DDL inclus.
- Rollback applicatif : conserver les données et le registre, retirer/désactiver le futur module d’exposition ; pas de DROP automatique. Attention : une fois 011 appliquée, les triggers continueront de retirer les offres périmées même si le binaire retourne à une version précédente ; comportement fail-closed intentionnel.
- Backup/restauration PostgreSQL complète avec rôles/ACL, contrôle des privilèges, test sur environnement isolé et autorisation explicite requis avant DDL distant ; aucune preuve de restauration hébergée disponible. **Distant BLOCKED / production No-Go.** Les diagnostics DB/Cloud actuels n’attestent pas 009–011.

## 6. Validation

Tests ciblés : **42/42 sur 3 fichiers**, 12 tests SQL/RLS, 21 tests de domaine et 9 du registre, 27,77 s. Tests portant notamment sur variantes, RLS/FK, source privée non exposée, prix/durées, invalidation, purge source tenant-scoped, DTO, seuils/horizon/marges, upgrade 010/008 et rollback 011.

Validation fraîche terminée à **08:35:35 UTC** :

| Contrôle | Code | Résultat |
|---|---:|---|
| `npm run db:schema:check` | 0 | Snapshot cohérent ; SQL 011 exporté vérifié par test |
| `npm run lint` | 0 | **0 erreur / 0 warning**, 225 fichiers |
| `npm test` | 0 | **489/489 tests, 55 fichiers**, début 08:28:53 UTC, durée **398,74 s** |
| `npm run build` | 0 | Compilation TypeScript et Vite réussies ; build Vite 956 ms hors TypeScript |
| `git diff --check` | 0 | Diff suivi propre ; nouveaux fichiers vérifiés séparément |
| Hashes sources/exports 009 et 010 | 0 | Quatre fichiers identiques au début du lot |
| `npm run db:check` | **1** | `missing_configuration`, `checkoutReady:false`, `refundsReady:false` ; aucune connexion distante prouvée |

**34 tests supplémentaires**, les 455 tests précédents sont conservés. Aucun timeout relevé ni assertion supprimée. Le module de domaine est aussi importé directement dans Node avec strip-types, sans dépendance navigateur. Avertissement de bundle existant inchangé : 613,89 kB minifié / 182,40 kB gzip, seuil Vite 500 kB dépassé et non masqué.

Logs temporaires non versionnés : `.cache/marketplace-02c/{targeted,schema,lint,tests,build,db-check,historical-hashes}.log`. Résultats essentiels conservés ici. Aucun commit/push ni déploiement effectué.

Tests SQL sur PostgreSQL embarqué PGlite : pas de preuve multi-connexion hébergée, de rollback de paiement ou de réservation publique réelle. Le constructeur d’offre n’est pas encore raccordé à une route, et les contrôles locaux de fenêtres ne résolvent pas les instants ambigus/inexistants DST.

## 7. Suite

PROMPT 02 toujours partiel : compléter notamment métadonnées média et, quand nécessaires/validés, extensions booking/droits/outbox. Le PROMPT 03 apportera commandes Gérant/UI Visibilité et publication atomique auditée ; PROMPT 05 raccordera ces règles au moteur unique de disponibilités/booking. Pas d’activation anticipée de la caisse ni de ventes à la réservation.

**PARTIAL — catalogue/règles implémentés au niveau données et domaine, pas encore une fonctionnalité publique déployée.**
