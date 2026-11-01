# Cahier cible ↔ code actuel : analyse et plan d’exécution

**Date : 31 octobre 2026.** Référence de départ : `cecb99dc7b784072b9f7a4075d8f664772d96bf5`, identique au commit cité par le cahier. Travail sur `arena/24f664e7-barbershop`, sans modification de `main`.

## 1. Référence, méthode et niveau de preuve

Le [document original](reference/SALON_PRO_Cahier_des_charges_et_plan_refonte.md) est conservé sans réécriture. Empreinte SHA-256 : `9c88e3ffc01e4a8bf80fc829c089232a60a5745d8d6c11abf3a1219e7f2dfce4`. Les décisions et états d’implémentation sont dans les documents de suivi, pas ajoutés au texte fourni.

Analyse fondée sur les modèles, migrations, moteurs serveur, routes, dépôts Dexie, contextes, formulaires réellement appelés et tests, puis exécution indépendante de la baseline. Les migrations fournissent une preuve de conception SQL, pas de configuration ni de sauvegarde de l’instance hébergée. Les étapes « livrées » historiques ne sont pas considérées comme une validation de production.

Baseline relancée : **118 tests / 23 fichiers passent**, schéma, lint, build et diff vérifiés. La CI de la PR #2 a cependant échoué à l’étape `npm test` (run GitHub `41169125235`) ; la cause exacte n’est pas établie à partir des logs disponibles. Un succès local ne rend pas ce run vert et ne justifie pas d’assouplir les contrôles. Voir [baseline](BASELINE_REFONTE.md).

## 2. Décisions structurantes

1. Conserver React/Vite, Node, Dexie, PostgreSQL privé et les écrans métier. Ni Next.js, ni réécriture du repository.
2. Produit ERP salon/coiffure/institut, pas plateforme publique de réservation. Agenda absent pour le moment ; à ajouter au lot 8, désactivé par défaut, sans dépendance de la caisse.
3. Supabase/PostgreSQL privé `salon_pro` est la cible documentaire. Les noms `neon*` restent des détails de compatibilité, pas une deuxième base ni une migration de fournisseur.
4. La vente d’un client et la souscription du salon sont deux domaines distincts ; pas de prix de plan ni de fournisseur de paiement inventé.
5. Les exemples de prestations du cahier ne sont pas injectés comme données métier : catégories structurelles seulement, configuration explicite par le responsable. Aucun compte de démonstration.
6. Lot 0 puis P0 checkout avant CRM, SaaS et agenda. La sauvegarde/restauration hébergée doit être prouvée avant une migration distante ; aucune modification du schéma distant dans ce premier sous-lot.

## 3. Matrice de comparaison fonctionnelle et technique

| Exigence du cahier | Preuve dans le code de départ | Écart concret / action | Priorité |
|---|---|---|---|
| Dashboard, périodes, KPI | `src/features/dashboard`, calculs `src/domain/calculations` | KPI issus du cache local ; pas de séparation systématique pending/confirmed. Ne pas présenter tous les chiffres comme validés serveur. | P0 fiabilité puis UX |
| Ticket multi-lignes, variantes, employé | `CheckoutTicketModal.tsx` → `SalonRepositoryHub.createCheckoutTicket` | Construction et calcul finaux encore locaux ; l’API sync n’est pas une commande d’encaissement commune aux rôles. | **P0 lot 1** |
| Prix/total/remise autoritaires | `saveService`, contrôles de tarifs locaux, `syncEngine.ts` | Un contrôle UI ou dépôt client n’est pas un contrôle financier serveur. Avant ce lot : pas de contrat serveur de préparation catalogue/paiements. | **P0** |
| Paiement fractionné et espèces | Modèles `TicketPaymentSplit`, `CashMovement`, UI ticket/caisse | Calcul local ; pas de garantie atomique serveur sur total net/splits/monnaie et session. | **P0** |
| Reçu unique et rejeu de commande | `generateReceiptNumber` dans le dépôt Dexie | Numérotation locale et IDs de mouvements ne remplacent pas une contrainte tenant + clé/hash/résultat de commande. Pas de registre de ticket canonique. | **P0** |
| Vente immuable / corrections inverses | `archiveRevenue`, `CorrectionLog`, tombstones | Traces locales présentes ; pas de commande serveur void/refund avec approbation, rapprochement et protection universelle des ventes finalisées. | P0 lot 2 |
| Stock transactionnel | `cashierStock.ts`, tests PostgreSQL de stock | Sorties Caissier dérivées et rollback ; chemin Gérant distinct. Les autres effets financiers restent hérités de sync. | P0 lot 1 |
| Catalogue / consommables | `ServiceCatalogItem`, variantes, `defaultConsumables` | À réutiliser ; ne pas faire confiance aux prix/consommations envoyés comme snapshots client. | P0 lot 1 |
| Projections minimales Caissier | `syncPolicy.ts`, `syncProtocol.ts` | Employés et réglages déjà projetés, mais `services.commissionOverride` était encore transmis. Corrigé dans ce sous-lot. Les dépenses/mouvements opérationnels peuvent toujours révéler des paiements de paie : arbitrer la visibilité avant GO. | P0 sécurité |
| Personnel / paie interne | `employees`, `payroll`, calculs de commission | Fonctionnel localement ; pas paie légale, ni portail employé requis. Préserver les calculs et ne pas interpréter une projection partielle comme un dossier complet. | Conserver, recette |
| Dépenses / récurrences | `expenses`, `recurringExpenses`, ponts paie/inventaire | Conserver ; corrections serveur et anti-double comptage inter-modules à vérifier dans les commandes. | P0/P1 |
| Fournisseurs / achats structurés | Achats et CUMP dans `saveProduct` et mouvements | Pas de modèles Supplier/Purchase/PurchaseLine ni carnet fournisseur dédié ; nom de module existant ≠ flux de réception complet. | Lot 5 |
| Client CRM | `RevenueEntry.clientName` seulement | Pas d’identité client, téléphone normalisé, historique dédié ni anonymisation contrôlée ; garder la vente anonyme. | Lot 5 |
| Agenda interne optionnel | Pas d’Appointment ni feature dédiée | Ne pas construire une marketplace. Flag/module et conversion ticket après stabilisation ERP/SaaS. | Lot 8, P2 |
| Organisation/tenant/membership | Migrations 003, `tenantContext.ts` | RLS et rôle réduit existants ; onboarding public organisation+tenant+propriétaire pas livré. La présence d’une table n’est pas un parcours commercial. | Lot 4 |
| Sessions et rôle courant | `sessions.ts`, `sessionCookies.ts`, `sessionClient.ts`, `resolveSessionTenant` | Accès court, refresh rotatif et révocation existants ; navigateur réel, multi-onglets et courses hébergées non prouvés. | Lot 3 P0 |
| Partition locale | `accountWorkspace.ts`, `SalonStoreProvider` | Séparation logique compte/rôle/salon et reprise conservatrice ; pas chiffrement ni protection contre le propriétaire du même profil navigateur. Premier chargement Cloud requis pour un nouvel espace. | Conserver, recette |
| Delta / conflits / offline | `cloudDelta.ts`, `syncProtocol.ts`, `CloudSyncProvider` | Checkpoints et archives présents, mais pas de file de commandes de tickets avec état pending/confirmed et référence officielle après acceptation. Historiques non compactés ; coûts de lecture tombstones/journal à mesurer. | P0 lot 1/3 |
| PWA | `pwaBuild.ts`, `PwaStatus.tsx`, manifeste/icônes | Précache public, pas API ; installation et cycle de mise à jour réels à valider selon `PWA_TESTING.md`. Cache ≠ sauvegarde. | Lot 3 |
| SaaS plans, quotas, abonnements | Pas de modèles dédiés dans le domaine | Ajouter control plane séparé, modes lecture/export/grâce, pas de suppression de données pour impayé. | Lots 6–7 |
| Paiement logiciel | Pas de prestataire/webhook validé | Étude CI/frais/disponibilité, signature, rejeu et rapprochement nécessaires. Aucun paiement simulé. | Lot 7 |
| Sauvegarde/restore, exploitation | Export JSON local, guides et CI | Pas de restauration PostgreSQL hébergée démontrée, ni monitoring/support/rollback exercés. | **P0 avant production** |
| Documentation | README de départ : Dexie v2, LWW, PIN, Neon seul | Inexact par rapport aux migrations 001–005 et au code actif. README réaligné ; documents historiques restent des traces datées. | Corrigé ici |

## 4. Flux réel et risque principal

```text
CheckoutTicketModal
  → SalonStoreProvider.mutate
  → SalonRepositoryHub.createCheckoutTicket
  → transaction Dexie (recettes, mouvements, produits, caisse, référence locale)
  → CloudSyncProvider construit un delta
  → POST /api/sync
  → validation de session/membership puis tenant/RLS
  → prepareSync + plan/validation CashierStock pour le Caissier
  → upserts PostgreSQL + triggers de révisions
  → retour/pull paginé + fusion atomique Dexie + archive de conflits
```

Ce chemin n’a pas de réservation/finalisation de **commande ticket** avec idempotence financière globale. Des IDs de lignes stables empêchent certains doublons, pas toutes les combinaisons prix/paiements/caisse. Le même comportement métier n’est pas imposé par une commande unique Gérant/Caissier. Une synchronisation réussie ne prouve donc pas le respect de toutes les règles RG-01 à RG-07.

**Correction immédiate d’UX :** le message « ticket validé » après seule écriture Dexie est remplacé par « enregistré sur cet appareil, confirmation serveur non établie ». Le formulaire et le reçu expliquent la provenance locale ; les références et montants historiques ne sont pas réécrits. Cela ne remplace pas encore les statuts de confirmation par ligne et les filtres de KPI du futur lot.

## 5. Contrats API constatés

| Route | Fonction actuelle | Limite / futur |
|---|---|---|
| `GET /api/health` | Disponibilité/configuration, pas secrets | Ne prouve pas l’accès réel DB |
| `/api/auth/status`, `/register`, `/login` | Auth/inscription hybride héritée | Register n’est pas l’onboarding complet de nouvel établissement |
| `POST /api/auth/refresh`, `/logout` | Rotation/révocation | Recette HTTPS requise |
| `/api/users`, `/provision`, `PATCH /api/users/:id` | Administration Gérant | Équipe/invitations/parcours SaaS à compléter |
| `POST /api/sync/verify` | Vérification historique | Pas une validation d’encaissement |
| `GET /api/sync/pull`, `POST /api/sync` | Snapshots/deltas, conflits et règles stock partiels | Ne doit pas remplacer les futures commandes métier |
| **`POST /api/checkout/quote` (nouveau)** | Préparation serveur sans effet financier | Statut `quoted`, `confirmed:false` ; pas de ticket final ni idempotence de commit |

## 6. Implémentation commencée : lot 1a (pas le lot 1 complet)

- DTO strict `CheckoutCommand` / `CheckoutQuote` distinct des lignes Dexie.
- Service serveur commun aux rôles : catalogue actif, appartenance des variantes, employé actif optionnel, prix attendus, total, remise Gérant avec motif, fractions de paiement, monnaie et session espèces.
- Entiers sûrs XOF ; répartition exacte des remises en BigInt sans flottants financiers.
- Besoins de stock cumulés entre revente et consommables standards, multipliés par les quantités ; refus de stock insuffisant et d’usage incompatible.
- Endpoint authentifié, tenant issu de la session/membership, FORCE RLS, limite de débit par salon/utilisateur. Aucun `tenantId`, prix imposé ou numéro de reçu accepté dans le DTO.
- Pas d’écriture financière, réservation de stock, création de reçu ou consommation de clé. Les tables techniques de session/rate-limit peuvent être mises à jour par le middleware.
- Projection services Caissier excluant les règles privées de commission, y compris snapshots/deltas.
- L’interface n’est **pas** basculée sur une fausse finalisation de devis. Le calcul sera réutilisé et réexécuté sous transaction au lot 1b ; l’UI actuelle continue à enregistrer localement en l’indiquant.

## 7. Ordre d’exécution et portes de sortie

| Lot du cahier | État à la fin de ce sous-lot | Suite / porte mesurable |
|---|---|---|
| 0 — Baseline/protection | Code, tag local de référence, flux, tests et non-régression établis ; backup hébergé **non prouvé** | Restaurer une vraie sauvegarde dans un environnement isolé avant DDL distant ; conserver l’original Dexie |
| 1 — Checkout autoritaire | **Partiel**, devis et commit atomique implémentés, registre tenant+clé/hash/résultat, reçu, protections des écritures confirmées ; migration 006 volontaire non déployée | 1c : file et formulaire commun en pilote optionnel implémentés ; bascule globale et fermeture du vieux chemin financier restent à faire. Backup/restore et recette dernière unité multi-connexion avant GO |
| 2 — Annulations/remboursements | À faire | Inverses stock/espèces par mode, motif/auteur, rapprochement et rapports sans suppression historique |
| 3 — Recette hébergée | À faire | Préproduction distincte, vrais secrets, HTTPS et navigateurs/appareils, concurrence réelle, restauration, métriques |
| 4 — Onboarding/RBAC | Socle réutilisable ; parcours à faire | Création atomique établissement + propriétaire ; invitations et activation ; politique de lecture paie opérationnelle |
| 5 — CRM/fournisseurs | À faire | Migrations additives, client facultatif et historique, réception achat/CUMP sans double dépense |
| 6 — Control plane | À faire | Plans configurables, quotas API et souscriptions/audit séparés des ventes |
| 7 — Paiement abonnement | À faire après choix fournisseur | Signature webhook, rejeu, rapprochement réel ; activation manuelle auditée si pilote |
| 8 — Agenda optionnel | À faire en dernier | Flag off par défaut, contrôle API, conflits horaires et conversion idempotente vers ticket |
| 9 — Pilote/exploitation | **No-Go aujourd’hui** | Backup/restore, observabilité, CI verte et protégée, tests HTTPS/multi-postes et parcours caisse validés |

## 8. Règles et arbitrages de ce démarrage

- Prix de base/variante ou prix de vente catalogue ; pas de prix arbitraire dans la nouvelle commande. `expectedUnitPrice`/`expectedTotal` servent à détecter un changement, pas à imposer un montant.
- Remise initiale en montant entier par ticket, motif obligatoire, Gérant seulement ; aucun droit de remise Caissier avant politique configurée et auditée. Pas de taux/prix de plan inventé.
- Les paiements du devis sont les parts **nettes** ; espèces remises et monnaie sont séparées. Une caisse serveur ouverte est exigée pour toute part espèces. Ce garde-fou cible le nouveau contrat, pas encore le vieux flux local.
- Paiements non espèces possibles sans session de caisse ; les variantes de service sont facultatives, mais si fournies doivent appartenir à la prestation.
- Le devis ne couvre pas encore les consommables manuels ajoutés librement dans le formulaire historique ; il dérive uniquement les standards du catalogue. Ne pas l’interpréter comme une validation de ce formulaire complet.
- Pas de règle fiscale/FNE affirmée, pas de paiement réel ni d’abonnement factice, pas de seed de prestations ou de données privées copiées dans le dépôt.

Les décisions commerciales (plans/prix, prestataire, quotas, conservation des contacts, limites de remise configurables) restent ouvertes. Elles ne bloquent pas le travail P0 de validation financière ; elles bloquent les promesses de lancement correspondantes.


## 9. Actualisation — lot 1b

`POST /api/checkout/commit` ajoute le registre idempotent, le reçu tenant et les écritures atomiques recettes/paiements intégrés/stock/caisse, avec auteur issu de l’appartenance vivante. La sync historique refuse de modifier/supprimer les écritures possédées par le registre ou d’en forger les références ; SQL bloque aussi leur update/delete. Les totaux de caisse sont réconciliés depuis le journal, y compris lors d’une modification/suppression de mouvement historique affectant cette caisse.

`006_checkout` reste **optionnelle**, non exécutée au démarrage et hors des migrations Supabase automatiques. Une base 005 continue de fonctionner, mais refuse commit avec 503. Aucun schéma distant ni sauvegarde/restauration n’a été modifié ou déclaré vérifié. Contrat et procédure : [checkout serveur](CHECKOUT_SERVEUR.md).

**No-Go P0 maintenu** : aucun branchement UI/Dexie n’est encore effectué. Les anciennes créations financières restent possibles, les consommables manuels du formulaire ne sont pas dans le DTO, et snapshots nominatifs/commissions historiques, corrections inverses et vraie concurrence hébergée restent à compléter. La matrice initiale compare le code de départ ; ce paragraphe et le tableau du lot 1 donnent l’état actuel.


## 10. Actualisation — lot 1c, pilote optionnel

La version 6 Dexie conserve une file séparée pending/confirmed/rejected, clé et scope immuables, bail/réessais et ACK canonique. Le formulaire Gérant/Caissier, le panneau et le reçu sont branchés **derrière `VITE_SERVER_CHECKOUT=true`**, désactivé par défaut. La sync pousse d’abord l’état local puis traite la file et récupère les deltas ; un ACK historique n’est jamais appliqué comme un stock courant. Les clôtures locales attendent confirmation/chargement des mouvements espèces. Le validateur DTO est maintenant partagé sans dépendance serveur dans le navigateur ; les catégories comptables de recette sont distinguées des catégories catalogue.

Validation locale : **169 tests / 28 fichiers**, schéma, lint et build OK. Pas de DDL distant ni activation du pilote en production. La section précédente décrit l’état à la fin de 1b ; le présent ajout le remplace pour Dexie et le formulaire pilote, pas pour les portes de sortie restantes. Supervision/résolution de file, sauvegarde dédiée et récupération après changement de rôle, globalisation des états/KPI, corrections et fermeture des autres chemins historiques restent à traiter avant GO. Voir [contrat détaillé](CHECKOUT_SERVEUR.md).


## 11. Actualisation — lot 1d, supervision/récupération

Lecture serveur `POST /api/checkout/status` sans finalisation implicite, supervision locale paginée/filtrée, backup dédié des intentions non confirmées, restauration atomique en suspension et reprise manuelle sous la même clé sont implémentés. Les fichiers n’attestent aucune confirmation et ne réécrivent pas les ACK existants. **190 tests / 31 fichiers**, schéma/lint/build/diff OK ; pas de changement du schéma hébergé.

La limite « pas de sauvegarde dédiée/résolution locale » du lot 1c est donc partiellement levée : ces outils existent pour le compte/rôle d’origine, pas pour une administration inter-acteurs ou après révocation/changement de rôle. La fermeture des créations financières historiques et autres portes P0 restent ouvertes. Le contrat décrit la procédure et ses limites (fichier privé non signé, absence serveur non assimilable à une annulation/paiement externe, aucun remplacement automatique). No-Go production inchangé.


## 12. Actualisation — lot 1e, bascule volontaire des ventes

Le garde serveur de la sync des ventes et un prévol authentifié existent désormais : legacy par défaut, enforced volontaire avec 006 et approbation. Refus atomique des écritures de recettes/effets de vente hérités, sans normaliser ni supprimer le backlog ; prévol client avant pull, diagnostic local et jeton capturé pour empêcher un envoi sous un compte remplacé. **210/210 tests / 35 fichiers**, schéma/lint/build/diff OK après isolation des démarrages froids dans les fixtures (assertions métier conservées).

La limite « fermeture non implémentée » est donc levée pour le **garde des ventes via sync**, pas pour l’activation ni la qualification de toutes les autres mutations financières. Le mode n’a pas été activé à distance. Inventaire de tous les postes/instances/salons, rapprochement des backlogs, preuve de sauvegarde/restauration, corrections inverses et recette hébergée restent nécessaires. Le contrat précise limites/bornes, autres mouvements manuels encore historiques et ordre opérateur ; No-Go production inchangé.

## Mise à jour lot 2a — remboursements

La commande serveur de remboursement intégral est désormais implémentée et couverte par 11 tests PostgreSQL/API : Gérant, motif, idempotence, inverses immuables, caisse ouverte provisionnée et retours produit explicites. 221 tests locaux passent au total. L'écart reste **partiellement fermé** : aucune UI/reprise offline remboursement, aucun avoir imprimable, aucun remboursement partiel ni exécution chez un prestataire. Les références externes sont des attestations auditées, pas des paiements exécutés. 007 privée Supabase est fournie en option locale, sans application hébergée ni activation. No-Go production inchangé.

## Mise à jour lot 2b — interface remboursement

L'interface Gérant est reliée aux tickets confirmés de la file locale. Intention persistée avant envoi, état incertain durable après coupure et reprise manuelle de la même clé après contrôle serveur. Un test intégré vérifie la récupération Dexie → API/SQL après commit dont la réponse est perdue ; 234 tests locaux passent. L'écart reste partiel : pas de recherche serveur multi-poste, d'avoir imprimable, d'export de reprise remboursement, de correction supervisée d'une intention refusée, de remboursement partiel ni d'exécution prestataire. Aucun DDL supplémentaire, aucune activation hébergée ; No-Go production maintenue.

## Mise à jour lot 2c — avoir imprimable

L'avoir de remboursement intégral est implémenté pour les résultats confirmés de l'espace local : références SPR/SPC, motif, montants historiques et modes attestés ; garde de cohérence et réimpression sans mutation. 256 tests locaux passent. L'écart documentaire se réduit mais l'impression réelle et la conformité fiscale ne sont pas validées. L'identité du salon reste la configuration locale actuelle, non historisée. Restent la recherche serveur multi-poste, la sauvegarde/reprise remboursement sur autre appareil, la correction supervisée des intentions refusées, les remboursements partiels et l'exécution des prestataires. Aucun DDL ou déploiement distant ; No-Go production inchangé.

## Mise à jour lot 2d — récupération des remboursements sur autre appareil

La sauvegarde dédiée des intentions est implémentée, avec import atomique réservé au même Gérant/salon/rôle et consultation du statut indépendante de la file de ventes locale. Une confirmation serveur récupérée permet de rouvrir l'avoir ; 278 tests locaux passent, dont intégration sur un second espace avec PostgreSQL/API. La reprise reste volontairement partielle : aucun renvoi d'une intention nouvellement importée, car le fichier non signé ne peut autoriser une exécution financière sur son seul montant attendu. Contrôle canonique et reprise sous préconditions serveur restent nécessaires, ainsi que recherche multi-poste, correction supervisée, remboursement partiel et exécution prestataires. Aucun changement hébergé ; No-Go production maintenu.

## Mise à jour lot 2e — reprise supervisée des intentions importées

Le blocage absolu d'exécution des intentions importées du lot 2d est remplacé par une reprise strictement conditionnelle : statut absent, contrôle du ticket canonique et des métadonnées, confirmation Gérant et préconditions comparées sous verrou serveur. Aucun changement de clé ou adoption silencieuse d'un montant divergent. 294 tests locaux passent, dont revalidation des fonds/droits, concurrence et intégration après restauration avec réponse perdue. Les corrections d'intentions refusées/changement de caisse restent absents, ainsi que recherche multi-poste générale, remboursements partiels et exécution des prestataires. Pas de nouvelle migration ni activation hébergée ; No-Go production maintenu.

## Mise à jour lot 2f — tickets canoniques multi-postes

La recherche serveur Gérant est implémentée pour les ventes canoniques de tous les postes/comptes du même salon : SPC exact et dates UTC, pages de 20, détail historique et état remboursement. Le détail permet de préparer un remboursement sans réimporter la vente dans Dexie ; droits et unicité restent contrôlés à l'exécution. 317 tests locaux passent, dont pagination microseconde, isolation et accès Gérant à une vente Caissier. L'écart est partiellement fermé : tickets legacy, recherche client/plein texte, export global et recette de charge non traités. L'avoir d'un remboursement d'un autre Gérant n'est pas exposé par cette recherche ; règles d'acteur inchangées. Aucun DDL/déploiement distant ou activation ; No-Go maintenu.

## Mise à jour lot 2g-a — diagnostic avant correction supervisée

Le diagnostic des obstacles de caisse et retours stock est implémenté pour le Gérant, avec contrôles du ticket canonique et calcul du solde depuis le journal sans écriture. 327 tests locaux passent. La correction effective de l'intention/changement de caisse reste absente : l'écart est **partiellement traité**, aucun déblocage automatique n'est revendiqué. L'aperçu est démarré sur 4173, mais la base PostgreSQL d'exécution n'y est pas configurée ; aucune recette Cloud ou nouvelle migration distante n'a été réalisée. No-Go production inchangé.
