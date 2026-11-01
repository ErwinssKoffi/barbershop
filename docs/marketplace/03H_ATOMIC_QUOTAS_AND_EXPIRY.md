# 03H — Quotas publics atomiques et masquage effectif à expiration

1er novembre 2026 — code et migration locale validés, sans application distante.

## Résultat livré

La migration volontaire `021_public_access_enforcement` ajoute des garanties SQL, indépendantes du panneau de contrôle :

| Ressource | Garantie ESSENTIEL |
|---|---|
| Projections de prestations publiques | Maximum 10 lignes par tenant |
| Projections de photos publiques | Maximum 3 lignes par tenant, logo/couverture/galerie compris |
| Réservations privées de médias | Maximum 3 médias pending/processing/ready ; rejected/deleted libèrent une place |
| Profil public | Visible seulement avec droit actif ou grâce encore valide, tenant actif et gate existant ouvert |
| Écritures de publication/upload | Droit actif obligatoire ; aucune nouvelle publication/upload pendant la grâce |

Les brouillons, la caisse et les rendez-vous restent préservés. Les limites de comptes/collaborateurs ERP ne sont **pas** ajoutées par cette tranche ; ces commandes nécessiteront leurs propres contrôles, sans bloquer les données existantes.

## Atomicité réelle, pas un simple comptage préalable

`salon_public_quota_usage` est une table privée FORCE RLS, inaccessible au runtime et au rôle public. Elle est initialisée depuis les lignes existantes sous verrous de tables pour éviter un backfill concurrent incohérent. Les triggers AFTER INSERT/UPDATE/DELETE maintiennent les réservations dans la transaction de l’écriture métier. Un UPDATE conditionnel atomique refuse un incrément au-delà du plafond ; rollback de l’écriture, du compteur et des événements de média ensemble.

L’usage d’un trigger AFTER évite le double comptage sur `INSERT ... ON CONFLICT DO UPDATE`. Les suppressions libèrent les places ; une fermeture de sécurité des projections (source indisponible, photo non rendable) reste possible même après révocation, y compris si la ligne était déjà fermée. Une projection fermée conserve sa place tant qu’elle n’est pas explicitement retirée : une invalidation ne permet donc pas de dépasser le quota en réactivant ensuite les lignes.

Les écritures acquièrent le verrou tenant et des verrous partagés sur ses périodes avant contrôle. Les compteurs sérialisent les allocations concurrentes ; en REPEATABLE READ, un snapshot obsolète peut échouer en `40001` et doit être rejoué dans une **nouvelle transaction**, jamais ignoré. Les échecs de quota/droit retournent `23514`. Aucun grant d’écriture de publication n’est ajouté au runtime.

## Masquage effectif sans cron

Une politique SELECT **restrictive** supplémentaire est installée sur `salon_public_visibility` pour le rôle public dédié. Elle vérifie les périodes 019, la révocation et le statut réel du tenant. L’horloge PostgreSQL `clock_timestamp()` est utilisée, pas la date du navigateur ni celle d’un début de transaction ancien.

Le gate existant ne suffit plus : une date `allowed_until` trop lointaine ne permet pas de rester visible après la grâce. La fin de grâce est exclusive. La copie de profil, ses prestations, ses règles et ses métadonnées de photos publiques passent déjà par ce gate via leurs politiques RLS ; ils deviennent donc illisibles au rôle public sans suppression physique ni tâche planifiée. Une révocation masque également les lectures suivantes. Le panneau Gérant relit cette autorité quand 021 est installée pour ne pas annoncer « visible » à partir du seul ancien gate.

La grâce conserve uniquement la lecture des copies existantes si le gate est encore ouvert. Les délais plus restrictifs du gate et les dépublications explicites restent respectés ; la future commande publish devra fixer une fenêtre cohérente avec la grâce. Un renouvellement valide peut redonner accès à une copie dont le gate reste explicitement demandé : aucun changement silencieux du booléen published n’est effectué ici.

**Frontière importante :** ceci protège les nouvelles lectures DB sous le rôle public, pas un contenu déjà téléchargé ou un cache/CDN externe. Aucun serveur HTTP public ou stockage d’images n’est encore livré. Le futur parcours devra empêcher tout cache public au-delà des droits et garder les originaux/objets privés ou protégés par URLs de courte durée. Une requête privilégiée propriétaire/service-role contournant RLS n’est pas un parcours public autorisé.

## Intégration et procédure d’application

Sources : `server/publicAccessEnforcementSchema.ts`, export `supabase/optional/021_public_access_enforcement.sql`, snapshot `db/schema.sql`. Anciens SQL non réécrits. Opt-in :

`npm run db:migrate -- --include-public-access-enforcement`

Exiger auparavant une sauvegarde **et une restauration vérifiées**, puis `SALON_MARKETPLACE_BACKUP_VERIFIED=true` dans l’environnement privé. Cet opt-in implique 009/011/012/019 en plus du socle 001–005 ; il n’implique ni 020/provisionnement opérateur ni les migrations financières/booking. Les anciens opt-ins ne sélectionnent pas 021.

La migration ne crée aucun abonnement, paiement ou donnée métier fictive. Des copies existantes sans droit valide seront masquées à son application ; inventorier les salons et leurs preuves réelles avant le basculement. Les lignes existantes au-delà des quotas sont conservées mais leur visibilité publique est refusée jusqu’à correction explicite. Les réservations pending restent comptées jusqu’à fermeture explicite ; aucun job automatique de nettoyage n’est prétendu.

Avant production : tester sauvegarde/restauration, rôles/ownership SECURITY DEFINER et RLS sur Supabase, débits/verrous et erreurs réseau, puis le vrai parcours HTTPS/cache/stockage. Ne pas appliquer le snapshot complet comme une migration automatique. Aucun DDL distant, compte opérateur, souscription réelle ou déploiement n’a été effectué dans cette tranche.

## Validation exécutée

- `npm run db:schema:check` : réussi.
- `npm run lint` : 0 erreur, 0 avertissement sur 281 fichiers.
- `npm test` final : **696/696 tests, 76 fichiers**, 611,77 s.
- `npm run build` : réussi ; avertissement de bundle existant 618,04 kB (gzip 183,62 kB).
- Sept tests SQL ajoutés : seuils 10/11 et 3/4, upsert, rollback, absence de droit, révocation, fin de grâce avec horloge réelle, isolation tenants, grants et maintien des fermetures de sécurité ERP.
- Un premier passage global a rencontré un timeout existant authFlows (5 s) : 11/11 au rejeu ciblé puis deux passages globaux à 696/696. Aucun timeout augmenté ni assertion supprimée. Le premier build a aussi révélé un type de retour d’option de migration incomplet, corrigé avant le passage final complet.

### Recette multi-connexion PostgreSQL 17.11 local

Un cluster éphémère privé, accessible uniquement par socket Unix 0700, a été démarré puis arrêté après test. Aucun port DB exposé ; binaires/données temporaires restent sous `.cache/` ignoré, aucune dépendance ajoutée au projet.

Script reproductible : `scripts/testPublicAccessConcurrency.ts`, lancé via `npm run test:public-access-concurrency` avec `SALON_TEST_PG_SOCKET` pointant sur le répertoire de socket privé d’une **base locale de test jetable** (port optionnel `SALON_TEST_PG_PORT`, défaut 55432). Le script refuse une URL réseau, utilise un schéma aléatoire, puis supprime son schéma et ses rôles. Il requiert un rôle administrateur local capable de créer les rôles de test. Ne jamais le lancer sur une base métier.

Résultats réellement observés :

1. READ COMMITTED : deuxième connexion effectivement bloquée par la première ; après commit de la troisième réservation, quatrième refusée `23514`.
2. REPEATABLE READ : snapshot antérieur refusé `40001`, usage reste 3.
3. Rafale de 8 connexions : exactement 3 succès, usage final 3.
4. Rollback explicite : réservation annulée, usage 0.

Ces résultats sont une preuve locale de concurrence, pas une recette hébergée Supabase/TLS.

## État de publication

Ces deux blocages techniques sont maintenant implémentés en base : quotas publics atomiques et expiration sur lecture publique. **La publication web reste fermée** pour les autres éléments non livrés : commande de projection complète auditée, traitement/stockage sécurisé des médias et recette hébergée. Le booléen `canPublish` reste false ; aucun bouton trompeur n’est activé. No-Go production maintenu pour ces raisons distinctes, et non parce que ces contrôles seraient encore de simples précontrôles.
