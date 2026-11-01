# ADR-005 — Autorité serveur des droits, SaaS et promotions distincts

- Date : 2026-11-01.
- Statut : **PROPOSÉ — décisions commerciales ouvertes**.
- Liens : [architecture](../01_TARGET_ARCHITECTURE.md), [gate public](ADR-002_PUBLIC_READ_MODEL.md).

## Contexte / alternatives

Le dépôt possède tenants/memberships et rôles Gérant/Caissier, mais pas de plans/souscriptions. Les paiements des tickets salon n’achètent pas des droits plateforme. Options : flags frontend/nom de plan codé en dur (rejetés), vérifications dispersées par endpoint (incohérentes), **résolution centralisée des capacités serveur**, retenue.

## Décision recommandée

Modèle piloté par données et audit : plans versionnés, entitlements typés, souscriptions tenant-scoped, événements immuables, provenance de l’activation, périodes, révision des droits. Capacités proposées : `public_profile_enabled`, `gallery_image_limit`, `public_services_enabled`, `online_booking_enabled`, `booking_horizon_days`, `marketing_analytics_enabled`, `featured_campaigns_enabled`. Aucune valeur/prix/essai/grâce prérempli commercialement sans validation produit.

Un service serveur unique calcule `effectiveEntitlements(tenant, instantDB)` pour chaque commande sensible. Il vérifie type, période, état et overrides audités ; refus par défaut en absence de droit explicite. Cache uniquement si validité et invalidation sont prouvées ; au MVP, relecture autoritaire dans la transaction. Quotas réservés atomiquement (upload/campagne/etc.), pas un simple count puis insert concurrent. Le frontend ne reçoit qu’une projection informative.

Les états candidats `trialing/active/past_due/grace_period/suspended/cancelled/expired` ne sont pas tous synonymes de droits identiques. Définir une table de transitions et d’effets approuvée avant code : qui peut changer, à quelle date, quel paiement/événement, quels droits pendant le délai. Pas de durée inventée, pas de montant flottant.

## Séparation suspension sécurité / fin commerciale

`tenants.status=suspended` sert aujourd’hui au refus de toute transaction métier : **ne pas l’utiliser pour une facture impayée**. La fin de droits commerciaux ferme nouvelles publications/uploads/bookings selon politique, sans supprimer les données, empêcher dépublication/suppression ni le traitement autorisé des RDV déjà pris. La révocation de compte ou suspension sécurité demeure prioritaire et peut légitimement fermer l’accès. Gate public atomiquement cohérent avec les droits ; échéances évaluées sans attendre un cron.

Le traitement financier historique et la récupération des données ne dépendent pas de la disponibilité du checkout SaaS ou du fournisseur. L’accès à de nouvelles fonctionnalités ERP payantes devra avoir une politique distincte explicite, jamais une désactivation silencieuse de la caisse existante dans ce projet.

## Control plane et onboarding

Rôle plateforme séparé des memberships métier, routes admin distinctes, authentification forte/révocation, journal acteur/motif/avant/après et accès support limité. Un Gérant ne s’attribue ni ce rôle ni une souscription « payée » via l’API. Un administrateur SaaS ne lit pas automatiquement paie/caisse.

Onboarding futur : créer organisation/tenant/membership initial et initialisation structurelle de façon transactionnelle/idempotente, sans utiliser `defaultTenantId` pour rattacher tous les nouveaux salons. Préserver le bootstrap existant et les vrais comptes ; aucun seed salon ni transfert silencieux des données.

## Paiement et boost

Pilote possible : activation manuelle **après vérification externe réelle**, opérateur autorisé, motif, montant entier XOF, période et référence externe audités. Pas de succès fictif ni d’activation par simple demande ou retour navigateur.

Fournisseur à comparer pour Côte d’Ivoire : moyens supportés, coûts, signature/rejeu webhooks, sandbox, règlements/remboursements et conformité. Aucun fournisseur choisi ou secret créé ici. Intention de paiement, ledger d’événements dédupliqués, vérification de signature/horodatage, rapprochement et activation atomique seront requis. Webhooks hors ordre/rejoués ou livrés après coupure billing doivent rester récupérables ; aucun 2xx si événement perdu sans persistance.

Boost = campagne ponctuelle séparée, période/emplacement/étiquette sponsorisée, éligibilité et preuve paiement/approbation. Il n’achète pas une capacité déjà comprise dans un forfait ; pas de duplication des ventes du salon ni de droit permanent déduit d’une campagne.

## Validation

Tests de permissions Gérant/Caissier/admin distincts, droits absents/expirés, transitions/hors-ordre, quota concurrent, gate fermé à expiration même sans worker, fin commerciale préservant RDV/données, webhook falsifié/rejoué et activation manuelle auditée. Les montants/quotas de fixtures ne doivent jamais devenir des defaults runtime.

Choix produits requis : plans/prix, durée des périodes, grâce/annulation/remboursement, rétention et règles de baisse de forfait. Pas de tables, paiement, rôle ni flag implémenté dans ce lot.

## Décisions utilisateur confirmées — 1er novembre 2026

Statut désormais **PARTIELLEMENT VALIDÉ** : choix d’une première offre et politique de période/grâce confirmés explicitement ; autres offres, contrôle plateforme et paiement automatisé restent ouverts.

- ESSENTIEL : 4 900 XOF par mois glissant, 1 établissement, 2 comptes (1 Gérant + 1 Caissier), 5 collaborateurs, 3 photos, 10 prestations visibles ; ERP caisse/recettes/dépenses/catalogue/stock standard/rapports essentiels inclus, profil public, boutons téléphone/WhatsApp et demandes de contact/rendez-vous.
- Demandes de rendez-vous à confirmer, **pas de réservation automatique**.
- Échéance au même jour/heure locale du mois cible, sinon dernier jour, avec ancrage initial préservé pour les renouvellements suivants.
- Grâce de 3 jours : fiche existante visible, aucune nouvelle publication/photo/demande publique ; puis fermeture de visibilité, sans suppression des données ni blocage de la caisse et des rendez-vous déjà pris.
- Activation manuelle auditée après vérification externe réelle, pas par le Gérant. Aucun abonnement actif par défaut, aucune simulation de paiement.

Implémentation locale 019, calculs et consultation documentés dans [03E_ESSENTIEL_SUBSCRIPTIONS.md](../03E_ESSENTIEL_SUBSCRIPTIONS.md). Les droits calculés ne sont pas encore appliqués au gate public ou aux commandes média/demande. Le contrôle plateforme authentifié, la preuve externe, la réservation atomique des quotas et la recette hébergée restent requis avant toute activation de publication. Les données ERP historiques sont préservées ; les limites ne les purgent pas rétroactivement.

### 03F — Activation privée par identité DB dédiée

Le contrôle plateforme initial est une CLI POSIX privée, pas un endpoint ERP. L’autorité réside dans un LOGIN PostgreSQL nominatif restreint et l’appartenance à une capacité NOLOGIN sans membre par défaut ; session_user attribue l’attestation. Un flag CLI ne remplace pas cette autorisation. Reçu immuable, déduplication par namespace/référence, rejeu et écritures atomiques sont obligatoires. La vérification réelle du paiement reste humaine ; ni MFA/SSO ni preuve provider automatisée ne sont présumés. Procédure et limites : [03F](../03F_PLATFORM_ACTIVATION.md). Aucun changement aux quotas, tarif ou règles calendaires approuvés ; enforcement public encore à raccorder.

### 03H — Autorité SQL et expiration sur lecture

Les quotas publics ne reposent plus seulement sur le précontrôle 03G : 021 utilise des compteurs privés mis à jour atomiquement dans la transaction des projections et des réservations médias. Les brouillons et données ERP existantes ne sont pas amputés. Le rôle public reçoit une politique restrictive de gate liée à l’abonnement réel, à l’horloge DB et à la grâce exclusive ; aucune tâche planifiée n’est nécessaire au masquage DB. Les couches HTTP/CDN et stockage devront respecter cette autorité sans republier des copies expirées depuis un cache. Recette locale multi-connexion PostgreSQL 17.11 passée ; hébergement Supabase encore à valider. Voir [03H](../03H_ATOMIC_QUOTAS_AND_EXPIRY.md).

### 03M — Première publication textuelle auditée

La capacité SQL 022 publie exclusivement une copie textuelle issue des sources DB, sans prix/période injectés par le client ni photos héritées. L’abonnement actif, le quota 021, l’identité tenant/Gérant et la version sont contrôlés dans la transaction ; visibilité finale limitée à la grâce, puis filtrage vivant 021. La reprise d’une intention déjà enregistrée ne republiant pas, elle ne peut réactiver un gate dépublié. Le flag serveur reste false par défaut et la validation finale du PROMPT 03 (fiche + photos sécurisées) reste ouverte. Périmètre, limites de reprise et preuves : [03M](../03M_ATOMIC_TEXT_PUBLICATION.md).
