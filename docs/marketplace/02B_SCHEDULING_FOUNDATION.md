# PROMPT 02 — Tranche 02B : horaires et exceptions

Date : 1er novembre 2026. Branche : `arena/1bd00d86-barbershop`.

Suite autorisée de la [tranche 02A](02_DATA_FOUNDATION.md). **Socle local uniquement**, toujours React/Vite, sans Next.js. Ce lot prépare les horaires du salon, pas les disponibilités individuelles d’employés ou la prise de réservation publique.

## 1. Réalisé et hors périmètre

- Migration additive volontaire **010**, source `server/schedulingSchema.ts`, export `supabase/optional/010_marketplace_scheduling.sql`, snapshot généré `db/schema.sql`.
- Types, validation des fenêtres/dates, priorité des exceptions et DTO public allowlist : `src/domain/scheduling.ts`.
- Intégration au registre et CLI par option distincte : **`includeScheduling` / `--include-scheduling`**. Dépendance 009 uniquement, pas 006/007/008.
- Tests SQL/RLS et de domaine : `schedulingSchema.test.ts`, `schedulingValidation.test.ts`, extension des tests du registre.

**Non livré :** formulaire horaires, commandes API, publication, calcul de slots UTC/DST, affectation employés, buffers, services réservables, média, notification ou souscription. L’agenda existant continue de fonctionner selon son contrat actuel ; ce lot ne lui applique pas silencieusement de nouveaux horaires. Pas de modification de la migration 009 ou des migrations historiques.

## 2. Modèle et sémantique

| Table | Contenu / frontière |
|---|---|
| `salon_opening_hours` | Brouillon hebdomadaire : un jour ISO 1–7 par tenant, lien composite tenant/profil, fenêtres locales et version |
| `schedule_exceptions` | Brouillon : une date locale par tenant, fenêtres de remplacement, note **privée**, version |
| `salon_public_schedules` | Entête publié : tenant/profil, fuseau explicite validé dans `pg_timezone_names`, révision et instant de publication ; FK vers profil publié |
| `salon_public_opening_hours` | Copie hebdomadaire publiée, sans donnée privée, FK tenant/profil/révision |
| `salon_public_schedule_exceptions` | Copie datée publiée, sans note privée, même révision que l’entête |

Les fenêtres utilisent **`int4multirange` natif PostgreSQL**, sans extension : minutes locales dans `[0,1440)`, début inclus / fin exclue. Exemple de structure : deux fenêtres séparées par une pause ; aucune fenêtre ni journée d’ouverture réelle n’est créée par la migration. Les fixtures de tests restent en bases éphémères.

- Ensemble vide = fermé. Jour absent = non configuré, traité **fermé**, jamais ouvert par défaut.
- Une exception datée remplace **toute** la journée hebdomadaire. Une fermeture exceptionnelle ne doit jamais retomber sur la semaine type.
- Le validateur TypeScript rejette les chevauchements/doublons, trie sans muter l’entrée et fusionne les bornes adjacentes. PostgreSQL canonise ses multiranges : une écriture privilégiée brute de fenêtres superposées serait fusionnée, pas rejetée ; les futures commandes doivent utiliser la validation avant stockage.
- Bornes négatives, au-delà de 1440 et non finies refusées en SQL ; date SQL infinie et jour ISO invalide refusés. Le contrat TypeScript exige une date calendrier stricte `YYYY-MM-DD`, sans année zéro ni date normalisée silencieusement.
- Une ouverture traversant minuit doit être scindée sur deux dates/jours ; aucun intervalle inversé supposé « nuit ».
- `updated_at/published_at` sont des `timestamptz`, `local_date` est volontairement une **date locale**, pas un instant UTC.

Le fuseau de publication est un **snapshot explicite** du réglage salon ; pas de nouveau défaut arbitraire à la place de `tenants.timezone`. Un changement de brouillon ou de fuseau salon ne modifie pas silencieusement les anciennes données publiées. La future commande de publication devra copier le fuseau courant validé et la configuration retenue dans une transaction, avec audit et révision ; les moteurs futurs devront préciser quelle version effective ils appliquent. Aucune conversion d’heure ambiguë/inexistante DST n’est revendiquée ici.

## 3. RLS, droits et projection

Cinq tables sous ENABLE + FORCE RLS, PK/FK tenant-scoped. Le runtime peut éditer/supprimer seulement les brouillons de son contexte tenant ; les données publiées sont **lecture seule** pour ce rôle. Supprimer une exception privée revient à retirer son override ; cela ne supprime pas la copie publiée.

Le rôle lecteur dédié de 009 ne reçoit SELECT que sur les trois tables publiées. Les policies suivent la chaîne : profil publié visible → entête horaire visible → lignes de même révision visibles. Dépublication, expiration du gate et suspension masquent donc les horaires et exceptions publiés, sans worker. Aucun SELECT des notes ou brouillons pour le lecteur, aucun droit d’écriture/publication, aucun grant navigateur. Les defaults de SELECT/EXECUTE défavorables sont révoqués explicitement pour `anon`/`authenticated`.

Le DTO public ne sérialise que fuseau/révision, jours/fenêtres et dates/fenêtres. Les IDs de tenant/profil, auteurs et notes privées sont exclus, même si l’objet reçu comporte des champs supplémentaires. `openingWindowsSqlValue` produit une valeur de paramètre multirange à caster ; ne jamais l’utiliser comme échappatoire pour interpoler du SQL utilisateur.

Comme en 02A, les permissions d’utilisateur Gérant/Caissier et l’audit atomique d’édition seront vérifiés dans les futures commandes métier : une policy SQL par tenant ne remplace pas l’autorisation Gérant. Aucun endpoint n’est ajouté ici. Aucun changement des modèles sync/Dexie ou de leurs tombstones ; ces données restent serveur uniquement, hors backup JSON local.

## 4. Migration et rollback

- Par défaut : 010 ignorée. **`--include-marketplace` conserve son sens 009 seulement** ; il ne commence pas à appliquer 010 à l’insu d’un opérateur.
- **`--include-scheduling` implique 009 puis 010** et exige la même approbation privée `SALON_MARKETPLACE_BACKUP_VERIFIED=true`. Aucun flag de ce type n’est créé/configuré par ce lot.
- Les tests appellent le registre sur PGlite uniquement. Pas de `db:migrate` réel exécuté ; le SQL optionnel n’est pas appliqué dans `public` ou dans un projet voisin.
- Échec SQL : rollback de tables, fonction/trigger et registre 010 ; 009 reste intacte si elle était appliquée avant. Les tests injectent un échec SQL après le DDL pour le vérifier.
- Retour binaire : conserver tables/registre/données ; l’ancien ERP ne dépend pas de ces horaires. Pas de DROP/down destructeur automatique. Une suppression SQL future exige backup/export, test sur restauration et autorisation explicite.
- Remplacer une révision publiée requiert une transaction cohérente des enfants et entête : les FK refusent des lignes d’une ancienne révision laissées derrière. La commande de publication n’existe pas encore.

**DDL distant toujours BLOCKED** : restauration PostgreSQL hébergée non prouvée. L’approbation d’environnement ne constitue pas cette preuve. Exiger avant tout distant le protocole backup/restore, inventaire du catalogue/roles, environnement isolé et autorisation définis en [02A](02_DATA_FOUNDATION.md). Les diagnostics DB/Cloud actuels ne vérifient pas la préparation 009/010.

## 5. Validation

Tests ciblés : **59/59 sur 4 fichiers**, incluant 17 tests 02A, 12 tests SQL horaires, 22 tests de domaine et 8 tests du registre (63,57 s). Isolation, références inter-salons/révisions, cardinalités, ranges, dates, grants, visibilité, notes privées, upgrade 009 et rollback 010 couverts.

Validation fraîche terminée à **08:18:59 UTC** :

| Contrôle | Code | Résultat |
|---|---:|---|
| `npm run db:schema:check` | 0 | Snapshot généré cohérent |
| `npm run lint` | 0 | **0 erreur / 0 warning**, 221 fichiers |
| `npm test` | 0 | **455/455 tests, 53 fichiers**, début 08:12:56 UTC, **362,70 s** |
| `npm run build` | 0 | TypeScript + Vite réussis, build Vite 928 ms hors TypeScript |
| `git diff --check` | 0 | Diff suivi propre ; nouveaux fichiers contrôlés séparément |
| Hashes source et SQL 009 | 0 | Identiques à ceux du début de ce lot ; 009 non réécrite |
| `npm run db:check` | **1** | `missing_configuration`, `checkoutReady:false`, `refundsReady:false` ; aucune connexion distante prouvée |

Avertissement de bundle existant inchangé : 613,89 kB minifié / 182,40 kB gzip, au-dessus du seuil Vite 500 kB ; pas masqué. Logs temporaires non versionnés dans `.cache/marketplace-02b/{targeted,schema,lint,build,tests,db-check}.log` ; résultats essentiels conservés ici. Aucun commit/push, déploiement ou DDL distant effectué.

**35 tests supplémentaires**, les 420 tests précédents restent verts. Aucun test désactivé ni délai relevé. Les tests PostgreSQL sont **embarqués PGlite** : pas une preuve de concurrence multi-connexion hébergée, E2E HTTPS, publication réelle ou moteur de booking. Le contrôle textuel des fenêtres locales ne constitue pas une validation DST des instants UTC.

## 6. Suite

Compléter les autres sous-tranches utiles du PROMPT 02 (services publics, métadonnées média, puis extension booking/droits/outbox selon les décisions validées) avant de prétendre disposer de tout le socle. Le PROMPT 03 apportera API/UI Visibilité et commandes de publication ; les PROMPT 05–06 raccorderont le moteur de disponibilités et l’agenda. Aucun passage automatique au lot suivant ni activation publique.

**PARTIAL — tranche 02B locale ; PROMPT 02 toujours en cours, No-Go production maintenu.**
