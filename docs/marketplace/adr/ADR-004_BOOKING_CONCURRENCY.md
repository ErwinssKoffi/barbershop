# ADR-004 — Évolution de 008 et moteur unique de réservation

- Date : 2026-11-01.
- Statut : **PROPOSÉ — faisabilité SQL et reprise à valider localement**.
- Liens : [architecture](../01_TARGET_ARCHITECTURE.md), [audit](../00_REPOSITORY_AUDIT.md).

## Contexte / alternatives

`server/booking.ts` et 008 existent : transaction tenant, verrou advisory du salon avant conflit/création, idempotence `(tenant_id, request_key)` avec hash/acteur, version, événements, statut et dates UTC. Pas d’exclusion SQL ni de vraie course multi-connexion testée. `created_by` et `booking_events.actor_id` exigent un utilisateur ERP ; l’API publique ne peut pas simplement les appeler comme un Gérant.

Options : nouveau moteur/table `appointments` et migration des anciens (risque double vérité/audit), conserver le verrou API seul (écritures hors API non protégées), **évolution additive de `bookings` avec verrou et invariant DB**, retenue. Le nom fonctionnel « appointments » ne justifie pas une duplication physique.

## Décision recommandée

- Garder IDs, request keys/hashes, versions, statuts et événements existants. Les routes privées actuelles restent des adaptateurs compatibles. Aucun renommage destructeur ni modification du SQL 008 déjà publié.
- Un moteur transactionnel partagé, avec **politiques d’acteur distinctes** : privé exige session/membership/rôle ; public exige gate et portée strictement limitée (services/dates/contact), jamais droits de Gérant. Aucun `salon_users` fictif/service account représentant les visiteurs.
- Évolution additive des auteurs : origine/acteur discriminés (`internal_user`, `public_request`, `system`) et références adaptées ; conserver les anciens auteurs, rendre la référence utilisateur facultative seulement pour les origines autorisées par CHECK. Même règle sur événements. Les capacités de gestion publique sont stockées hachées et séparées des payloads lisibles par la sync/logs.
- Snapshots de service/variante, prix XOF et durée au moment du RDV, plus lignes liées par FK `(tenant_id, booking_id)` ; une seule ligne réservable au MVP, extension multi-services ultérieure. Les anciens RDV sans prix/variante restent explicitement historiques, pas de prix rétroactif inventé.
- Ressources/blocages/horaires partagent le même moteur d’occupation. Pour l’initial, conserver les blocs `kind=unavailable` dans `bookings` ; pas de table séparée qui échapperait à l’exclusion. Les récurrences génèrent/intersectent des occurrences sous règles validées.

## Transaction et concurrence

Ordre de verrous documenté : contexte tenant → advisory du salon (actuel) → lignes gate/règles/ressources/services nécessaires → relecture intention → calcul/revalidation → écriture booking/événement/outbox → commit. Toutes les mutations horaires/blocages/état réservable concurrentes doivent participer au même protocole, ou fournir une vérification de révision atomique équivalente. Ne pas seulement verrouiller create/update et oublier une édition d’horaires.

Garder la sérialisation tenant au MVP (débit à mesurer), ne pas optimiser prématurément par employé. Revalider bornes/horizon, durée dérivée, IANA, disponibilité complète, état des ressources/services et gate/droits ; l’affichage préalable n’est pas autorisant. UPDATE exige toujours `expectedVersion` ; deadlocks/timeouts rendent une erreur contrôlée et une intention rejouable.

Ajouter avant activation publique une exclusion GiST sur `(tenant_id =, employee_id =, tstzrange(start_at,end_at,'[)') &&)` pour statuts bloquants (tous sauf `cancelled/no_show`), qui couvre rendez-vous et indisponibilités. Extension `btree_gist`, privilèges d’installation et placement dans le schéma correct **à vérifier** sur le fournisseur. Si indisponible, ne pas activer le booking public sans solution DB équivalente explicitement revue. Mapper SQLSTATE d’exclusion en 409 ; une erreur annule booking, événement et outbox.

Les nouvelles FK sont tenant-composites. Pour les références aux anciens employés/services, vérifier d’abord la compatibilité des suppressions/tombstones et de l’historique : pas de CASCADE effaçant les RDV, pas de FK ajoutée qui casse la purge. Une ressource de scheduling stable/archivée peut conserver l’identité historique sans recréer un employé actif ; conception/backfill à prouver en phase 02. Les snapshots restent lisibles après archivage d’un catalogue. Cette inconnue bloque l’ajout de ces FK, pas les données existantes.

## Reprise / idempotence / rollback

- Migration locale depuis baseline sans 008 et depuis 008, additive opt-in. Audit des overlaps et références historiques **avant** contrainte ; conflits remontés pour décision, jamais annulés silencieusement.
- Une exclusion ne s’ajoute pas avec `NOT VALID` : prévoir verrouillage/maintenance et volumétrie ; ne pas promettre un ajout concurrent sans blocage. Vérifier extension et contraintes avant DDL distant, backup/restore requis.
- Intention publique : clé aléatoire + hash canonique et portée requérant/tenant, refus de même clé avec contenu différent. Ne pas retourner PII/capacité à un tiers sur seule connaissance d’une clé. Capacité de retry/secrète fournie par le client et hachée, ou protocole équivalent validé, nécessaire pour récupérer un résultat perdu de façon sûre ; pas de clé publique courte autorisante.
- Même intention après perte réseau : retrouver résultat canonique, pas nouveau booking. Aucune queue booking offline ni succès local simulé.
- Un RDV n’écrit jamais argent/stock. Le lien booking→ticket sera unique et atomique avec checkout en phase 06.
- Après premières écritures publiques, rollback uniquement vers une version comprenant acteurs/snapshots publics. Désactiver nouvelles créations sans supprimer ni empêcher le suivi autorisé des RDV pris ; pas de downgrade aveugle à l’ancien binaire.

## Preuves avant Go public

PostgreSQL multi-connexion réel : deux créations concurrentes même ressource, public contre privé, bornes adjacentes, autres tenants, blocage contre RDV, dépublication/horaires modifiés, ressource désactivée, annulation contre création, deux retries d’intention et rollback d’audit/outbox. Tester une écriture SQL autorisée hors API rejetée par exclusion. PGlite reste utile mais insuffisant. Aucun DDL/code ou résultat de concurrence réelle livré par cette ADR.
