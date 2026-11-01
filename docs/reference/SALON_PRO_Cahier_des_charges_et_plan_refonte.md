**SALON PRO**

**CAHIER DES CHARGES CIBLE**

**ET PLAN PRÉCIS DE REFONTE / FINALISATION DU REPOSITORY**

|     |
|-----|

**POSITIONNEMENT VALIDÉ**

**Produit** ERP de gestion pour salons de coiffure, barbershops et instituts de beauté

**Rendez-vous** Module optionnel, activable par établissement

**Clientèle cible** Barbiers + salons de coiffure + instituts de beauté

**Modèle** SaaS multi-établissements / multi-comptes, FCFA (XOF)

**Repository analysé** ErwinssKoffi/barbershop — branche main

**Référence d’analyse** Commit cecb99dc — 31 octobre 2026

*Document de travail produit + technique*

Version 1.0 \| 31 octobre 2026 \| Base de référence : état du repository public consulté à cette date

# Sommaire exécutif

La décision produit est de faire de SALON PRO un ERP léger mais sérieux, centré sur l’exploitation quotidienne d’un établissement : encaissement, caisse, recettes, dépenses, prestations, personnel, consommables / produits, et pilotage. Le produit doit servir aussi bien un barbershop qu’un salon de coiffure ou un institut de beauté. Les rendez-vous sont une capacité secondaire et désactivable ; ils ne doivent jamais conditionner le fonctionnement de la caisse ou des autres modules.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Décision technique majeure</strong></p>
<p>Conserver le repository existant et le faire évoluer par lots ciblés. Ne pas réécrire les modules métier déjà présents. Le risque principal n’est plus l’absence d’une base applicative : c’est la finalisation du flux d’encaissement côté serveur, la validation réelle du déploiement, puis l’ajout du minimum commercial nécessaire pour exploiter un SaaS.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **Partie**                         | **Contenu**                                                                                  |
|------------------------------------|----------------------------------------------------------------------------------------------|
| 1\. Positionnement et objectifs    | Vision produit, utilisateurs, règles de conception et exclusions.                            |
| 2\. Cahier des charges fonctionnel | Modules, fonctions, parcours métier, règles de gestion et critères d’acceptation.            |
| 3\. Architecture cible             | Stack à conserver, flux de données, multi-tenant, sécurité, offline et évolutivité.          |
| 4\. Audit du repository            | Fonctionnalités existantes, maturité documentée, manques réels et décisions de conservation. |
| 5\. Plan de refonte / finalisation | Lots ordonnés, fichiers et composants concernés, livrables et portes de validation.          |
| 6\. Recette et mise en production  | Stratégie de tests, critères Go/No-Go, exploitation et indicateurs de succès.                |

## Synthèse de l’état de départ

| **Domaine**          | **État observé dans le dépôt**                                                                                                  | **Décision**                                            |
|----------------------|---------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------|
| ERP métier           | Dashboard, caisse, recettes, dépenses, services, employés, paie, inventaire, rapports, budget, paramètres sont déjà structurés. | Réutiliser ; corriger seulement les écarts prouvés.     |
| Socle SaaS           | Organisations/tenants, memberships, RLS, sessions révocables et espaces locaux par compte/rôle documentés.                      | Conserver ; compléter onboarding et recette hébergée.   |
| Offline / PWA        | Worker, précache du shell, Dexie partitionnée et synchronisation delta documentés.                                              | Conserver ; valider sur vrais navigateurs et appareils. |
| Encaissement serveur | Stock Caissier partiellement dérivé côté serveur ; prix, remises, paiements, caisse et reçu pas encore tous autoritaires.       | Priorité P0 : terminer et unifier.                      |
| CRM / agenda         | Pas de modèle Client ou RendezVous dédié identifié ; RevenueEntry contient seulement clientName optionnel.                      | Ajouter CRM ; agenda optionnel.                         |
| SaaS commercial      | Plans, abonnements, paiement récurrent, onboarding autonome et console éditeur non terminés.                                    | Construire après sécurisation du cœur métier.           |

Important : les mentions « livré » et « tests réussis » dans IMPLEMENTATION_PROGRESS.md sont des éléments déclarés dans le suivi du dépôt. Elles ne remplacent pas une recette indépendante du parcours complet en HTTPS, avec une vraie connexion PostgreSQL/Supabase hébergée et plusieurs postes concurrents.

# 1. Positionnement produit et objectifs

## 1.1 Vision

SALON PRO est un logiciel web SaaS de gestion opérationnelle et financière destiné aux établissements de beauté et de coiffure. Il aide le gérant à savoir ce qui est vendu, encaissé, dépensé, consommé en stock et dû au personnel, avec une lecture fiable de l’activité par période, mode de paiement, service et collaborateur.

## 1.2 Promesse centrale

- Centraliser les opérations du salon dans un seul espace simple à prendre en main.

- Réduire les erreurs d’encaissement, les écarts de caisse, les pertes de stock et les doubles saisies.

- Connaître le chiffre d’affaires, les charges opérationnelles et les marges indicatives sans présenter l’outil comme un logiciel de comptabilité statutaire.

- Permettre une continuité de travail en cas de connexion instable, puis synchroniser sans doublons.

- Isoler strictement les données de chaque établissement dans le SaaS.

- Accommoder les métiers différents par paramétrage de catégories et de prestations, sans multiplier les versions du produit.

## 1.3 Segments de clientèle

| **Segment**        | **Exemples de prestations / fonctionnement**                                  | **Adaptation produit**                                                  |
|--------------------|-------------------------------------------------------------------------------|-------------------------------------------------------------------------|
| Barbershop         | Coupe, dégradé, barbe, rasage, soins barbe, forfaits.                         | Catalogue rapide, caisse au comptoir, prestations courtes, commissions. |
| Salon de coiffure  | Coupe, brushing, coloration, tresses, soins capillaires, vente de produits.   | Variantes de prix/durée, consommables et ventes de produits.            |
| Institut de beauté | Manucure, pédicure, soins visage/corps, maquillage, cils/sourcils, épilation. | Catégories personnalisables, durées, affectation à un spécialiste.      |

Le logiciel doit rester générique dans ses objets métier : prestation, variante, employé, produit, consommable, ticket, paiement. Les exemples ci-dessus servent de configuration initiale, pas de code métier spécifique à chaque type d’établissement.

## 1.4 Principes de produit

- Simplicité avant exhaustivité : les fonctions avancées sont masquées ou optionnelles tant qu’elles ne sont pas nécessaires.

- Un même catalogue de services avec catégories, variantes, durée indicative et consommables par défaut.

- Un ticket unique peut comporter plusieurs prestations et produits, avec un collaborateur par ligne.

- Une vente finalisée est immuable dans son historique ; une annulation ou correction crée une opération traçable.

- Les données financières sont stockées en entiers XOF/FCFA, jamais en flottants.

- Les rendez-vous sont une option de module ; l’application reste pleinement opérationnelle lorsque le module est désactivé.

# 2. Utilisateurs et droits

## 2.1 Profils utilisateurs cibles

| **Profil**                | **Responsabilités**                                                                                      | **Droits cibles**                                                                                                        |
|---------------------------|----------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|
| Gérant / Propriétaire     | Pilote le salon, paramètre les prestations, prix, employés, stock, dépenses, paie et rapports.           | Accès complet aux données et paramètres de son tenant ; gestion des membres et de la caisse.                             |
| Caissier / Réception      | Crée les tickets, encaisse, ouvre/clôture sa caisse et consulte les informations nécessaires au service. | Accès opérationnel limité ; pas d’accès aux salaires, taux de commission, configuration sensible ni administration SaaS. |
| Employé / Prestataire     | Exécute les prestations ; n’a pas besoin d’un compte obligatoire dans la première version.               | Pas de portail employé obligatoire au lancement ; ses ventes et commissions sont suivies par le gérant.                  |
| Administrateur plateforme | Opère le SaaS : comptes clients, plans, abonnements, assistance et statut technique.                     | Accès de plateforme isolé des données métier ; accès métier exceptionnel, contrôlé et audité.                            |

Le dépôt possède actuellement les rôles Gérant/Caissier au niveau salon. Le rôle Employé autonome n’est pas nécessaire pour le MVP. L’administrateur plateforme doit être un rôle de contrôle SaaS, pas un troisième rôle métier injecté indistinctement dans chaque salon.

## 2.2 Matrice indicative

| **Fonction**                       | **Gérant** | **Caissier**                          | **Plateforme**    |
|------------------------------------|------------|---------------------------------------|-------------------|
| Encaisser / ticket                 | Oui        | Oui                                   | Non               |
| Ouverture / clôture caisse         | Oui        | Oui, selon affectation                | Non               |
| Catalogue et tarifs                | Oui        | Lecture                               | Non               |
| Gestion du stock / achats          | Oui        | Lecture ou périmètre restreint        | Non               |
| Dépenses / paie / budget           | Oui        | Non ou lecture strictement nécessaire | Non               |
| Rapports financiers                | Oui        | Rapport de caisse limité              | Non               |
| Utilisateurs du salon              | Oui        | Non                                   | Support encadré   |
| Plans / abonnements                | Non        | Non                                   | Oui               |
| Accès aux données d’un autre salon | Non        | Non                                   | Jamais par défaut |

## 2.3 Exigences de sécurité RBAC

- Chaque API vérifie l’identité, la session active, le tenant résolu côté serveur et le rôle/membership actuel en base.

- Le tenantId reçu dans un payload client ne constitue jamais une preuve d’autorisation.

- Le contrôle d’accès est appliqué au niveau des routes ET des entités/champs retournés ; masquer un bouton dans l’interface ne suffit pas.

- Les vues Caissier utilisent des projections minimales : pas de salaire, téléphone privé, note administrative ou taux de commission si inutile.

- Les privilèges plateforme sont distincts des privilèges métier et les opérations d’assistance sont journalisées.

# 3. Cahier des charges fonctionnel cible

## 3.1 Tableau de bord

Objectif : donner au gérant un aperçu immédiat et compréhensible de la performance du salon, avec une période sélectionnable.

- Afficher le chiffre d’affaires du jour, de la semaine et du mois, comparé à la période précédente.

- Afficher recettes encaissées, dépenses, résultat opérationnel indicatif, panier moyen et nombre de tickets.

- Présenter les ventes par service, produit, employé et mode de paiement.

- Présenter alertes : caisse non clôturée, stock sous seuil, synchronisation en attente, charges récurrentes à régler et paie à préparer.

- Fournir des liens vers les opérations à corriger ou à examiner.

Critère d’acceptation : chaque KPI est calculé à partir des opérations validées et de la période active ; les opérations en attente de synchronisation sont visuellement distinguées des données confirmées par le serveur.

## 3.2 Caisse et encaissement — module prioritaire

Objectif : sécuriser le moment où le client paie. Le ticket est l’unité centrale de l’encaissement.

- Créer un ticket contenant une ou plusieurs prestations et/ou produits de revente.

- Choisir une variante de prestation et un employé par ligne ; appliquer durée et consommables par défaut lorsque configurés.

- Afficher prix unitaire, quantité, remise autorisée, sous-total, total à payer et monnaie à rendre.

- Accepter un paiement unique ou fractionné : espèces, Wave, Orange Money, MTN MoMo, carte, virement ou autre mode configuré.

- Ne faire évoluer le solde de la caisse physique que de la part réellement payée en espèces.

- Associer un client existant ou saisir un client comptoir sans imposer la création d’une fiche.

- Imprimer un reçu 80 mm ou A5, avec identité du salon, référence du ticket, lignes, montants, modes de paiement et note de bas de page.

- Empêcher un double encaissement par une clé d’idempotence stable ; un rejeu ne crée ni second ticket ni double décrément de stock.

- Enregistrer la vente, les paiements, les mouvements de caisse, les sorties de stock et les consommables dans une transaction cohérente.

- Gérer annulation, remboursement et correction au moyen d’opérations inverses traçables et soumises au rôle autorisé.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Règle d’intégrité</strong></p>
<p>Le serveur recalcule et valide les prix, variantes, remises, totaux, répartitions de paiement, caisse, numéro de reçu et effets de stock. Le navigateur propose le ticket, mais ne fait pas autorité sur le montant à enregistrer.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

Critères d’acceptation : un ticket dont le prix a été manipulé côté navigateur est rejeté ou recalculé ; les sommes des paiements égalent le total net ; la part espèces correspond au mouvement de caisse ; un échec stock annule toute la transaction ; un rejeu produit le même résultat canonique sans doublon.

## 3.3 Catalogue de prestations et tarifs

- Créer, modifier, désactiver et classer des prestations par catégories configurables.

- Gérer description, prix de référence, durée indicative, variantes (ex. cheveux courts/longs, niveau de soin) et prix verrouillé si besoin.

- Associer des consommables standards à une prestation sans les facturer séparément au client.

- Configurer une règle de commission par service en complément de la règle de commission employé, si activée.

- Conserver dans le ticket le libellé, prix et variante historiques même après modification du catalogue.

Critère d’acceptation : la désactivation d’une prestation empêche les nouveaux tickets, mais ne modifie pas l’historique ni les rapports passés.

## 3.4 Produits, consommables, achats et fournisseurs

- Gérer produits de revente, consommables cabine et produits à usage mixte.

- Fiche produit : nom, référence/SKU, catégorie, unité, usage, prix d’achat, prix de vente, quantité, seuil d’alerte et statut.

- Enregistrer les fournisseurs avec coordonnées de base, références et historique des achats.

- Enregistrer un achat/réception de stock, quantité réellement reçue, coût unitaire, fournisseur et mode de règlement.

- Recalculer le coût unitaire moyen pondéré (CUMP) au moment de la réception.

- Enregistrer les mouvements : vente, consommation, achat, perte, retour, correction et inventaire.

- Produire un inventaire physique, comparer quantité théorique et comptée, puis créer un ajustement justifié.

- Empêcher qu’un achat de stock soit comptabilisé une seconde fois en dépense générale.

Critère d’acceptation : toute variation de quantité est accompagnée d’un mouvement historisé ; les ventes et consommations ne créent jamais de stock négatif sans règle explicitement autorisée ; les corrections exigent un motif.

## 3.5 Clients — CRM léger à ajouter

Le CRM doit rester pratique et non intrusif. Une fiche client ne doit pas devenir une condition obligatoire pour encaisser.

- Créer une fiche avec nom, téléphone facultatif, e-mail facultatif, date de naissance facultative, préférences et note interne.

- Rechercher par nom ou numéro ; proposer les correspondances pour limiter les doublons.

- Consulter historique des visites, prestations, achats, dépenses cumulées et dernière visite.

- Associer un ticket à une fiche client ; garder la possibilité d’un client anonyme/comptoir.

- Permettre export contrôlé et suppression/anonymisation selon politique de conservation validée.

Critère d’acceptation : un ticket client est visible dans l’historique après synchronisation ; le champ client ne peut pas exposer des données d’un autre tenant ; aucune donnée de contact n’est requise pour une vente anonyme.

## 3.6 Personnel, commissions et paie simple

- Conserver les fiches employés, fonction, statut actif, date d’embauche et informations opérationnelles.

- Attribuer chaque prestation/vente à un collaborateur pour mesurer son chiffre d’affaires.

- Conserver les bases de commission existantes : prestations seules, prestations + produits, ou CA global, avec éventuelle règle spécifique au service.

- Gérer salaire fixe, avances, primes, paiements partiels et solde mensuel.

- Produire reçu/bulletin interne imprimable et journal des versements.

Limite fonctionnelle : il s’agit d’un suivi interne des rémunérations et commissions, pas d’un moteur de paie légale, de déclarations sociales ou de gestion complète des congés/présences.

## 3.7 Dépenses et charges récurrentes

- Saisir une dépense avec date, libellé, catégorie, montant, bénéficiaire, mode de paiement, justificatif/référence et note.

- Gérer des modèles de charges fixes mensuelles et leur état à payer/payé.

- Lier les paiements de paie et les achats de stock à leur module source pour éviter les doublons.

- Corriger une dépense via opération tracée ; interdire les suppressions physiques non auditables.

## 3.8 Rendez-vous — module optionnel

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Positionnement validé</strong></p>
<p>Module désactivable par le gérant et, le cas échéant, inclus selon le plan SaaS. Il s’agit d’un agenda interne du salon ; pas d’une marketplace ni d’un portail de réservation publique dans la version cible initiale.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

- Activation/désactivation dans Paramètres ou selon la permission du plan.

- Créer un rendez-vous depuis un client, une prestation ou le calendrier.

- Renseigner date/heure, durée, client facultatif, prestation(s), employé et note.

- Afficher un calendrier jour/semaine et une liste des rendez-vous à venir.

- Gérer les statuts : demandé, confirmé, arrivé, terminé, absent, annulé.

- Éviter les conflits horaires selon la disponibilité du collaborateur, avec dérogation explicite du gérant.

- Convertir un rendez-vous en ticket sans ressaisir client, service, employé et prix.

Critère d’acceptation : si le module est désactivé, ses routes et menus ne perturbent pas les autres modules ; aucune vente ne requiert un rendez-vous préalable.

## 3.9 Rapports, budgets et pilotage

- Rapport journalier de caisse : ouverture, entrées, sorties, espèces attendues, espèces comptées et écart.

- Rapport de recettes par période, catégorie, service, employé et mode de paiement.

- Rapport de dépenses, charges récurrentes et paiements de personnel.

- Rapport de stock : état, mouvements, valorisation indicative au CUMP, ruptures et pertes.

- Journal d’audit avec avant/après, motif, auteur et horodatage.

- Export CSV et impression lisible A4 ; reçu client 80 mm/A5.

- Conserver le module Budget existant mais le traiter comme option avancée : objectifs et plafonds ne doivent pas bloquer la mise en service.

## 3.10 Paramètres salon et configuration métier

- Profil du salon : nom commercial, logo, adresse, téléphone, responsable et devise XOF.

- Préconfigurations de départ : Barbershop, Salon de coiffure, Institut de beauté, puis catégories et prestations modifiables.

- Formats de reçu, note d’en-tête/pied, catégories, modes de paiement et seuils de stock.

- Gestion des utilisateurs du salon, invitation/provisionnement et révocation des accès.

- Synchronisation, état hors ligne, sauvegarde/restauration, mises à jour PWA et informations de compte.

# 4. Périmètre SaaS commercial

## 4.1 Onboarding d’un nouvel établissement

1.  Le propriétaire crée son compte avec e-mail/téléphone et mot de passe conforme à la politique du produit.

2.  Le système crée une organisation cliente et un tenant/établissement de manière atomique, sans accepter un tenantId arbitraire depuis le navigateur.

3.  Le gérant renseigne le profil de son établissement, choisit son type principal et les modules optionnels.

4.  Le système charge une configuration initiale adaptée : catégories, exemples de prestations, modes de paiement et paramètres par défaut.

5.  Le gérant ajoute les premiers employés, crée les accès Caissier et importe éventuellement son stock initial.

6.  Un contrôle final confirme que les données appartiennent au nouveau tenant, puis ouvre le tableau de bord.

Le modèle multi-tenant serveur existe déjà dans le dépôt, mais le suivi d’implémentation précise que la création publique de nouvelles organisations/tenants et le parcours complet d’onboarding restent à réaliser.

## 4.2 Plans et limites

Prévoir au lancement deux niveaux maximum, avec noms et prix décidés après validation commerciale. Les limites doivent être configurables en base et non codées en dur dans les composants.

| **Paramètre commercial** | **Plan Essentiel (base)**                                       | **Plan Pro (étendu)**                                                  |
|--------------------------|-----------------------------------------------------------------|------------------------------------------------------------------------|
| Établissements           | 1                                                               | 1 au lancement ; multi-sites à cadrer ensuite                          |
| Comptes utilisateurs     | Petit quota configurable                                        | Quota supérieur configurable                                           |
| Modules ERP              | Caisse, recettes, dépenses, services, employés, stock, rapports | Tous les modules du plan de base + paie/budget avancés selon arbitrage |
| Rendez-vous              | Option / selon choix du plan                                    | Option incluse ou activable                                            |
| Exports / sauvegardes    | Exports standards                                               | Exports et outils avancés                                              |
| Support                  | Standard                                                        | Prioritaire, si capacité opérationnelle                                |

Ne pas figer de prix dans le cahier des charges : les tarifs, durée d’essai, quotas et politique de grâce doivent être déterminés par les coûts d’hébergement, le pouvoir d’achat cible et la valeur réellement délivrée.

## 4.3 Cycle de vie abonnement

- Statut supporté : trial.

- Statut supporté : active.

- Statut supporté : past_due.

- Statut supporté : grace_period.

- Statut supporté : suspended.

- Statut supporté : cancelled.

- Statut supporté : expired.

Exigences : date de début/fin, renouvellement, plan courant, quotas, historique des factures, tentatives de paiement, changement de plan, suspension et réactivation. Une échéance impayée ne doit jamais effacer les données métier. Prévoir une période de grâce paramétrable et un mode lecture/export avant suspension totale.

## 4.4 Console administrateur de la plateforme

- Lister les organisations, tenants, comptes propriétaires, plans, statuts et dates d’échéance.

- Activer/suspendre/réactiver un abonnement selon des règles explicites et auditées.

- Consulter les paiements d’abonnement, factures SaaS et erreurs de webhook.

- Modifier les quotas/flags et ouvrir un dossier de support.

- Afficher des métriques agrégées (salons actifs, abonnements actifs, MRR, échecs de paiement) sans parcourir inutilement les recettes nominatives des salons.

## 4.5 Paiements d’abonnement

L’intégration d’un prestataire de paiement ne doit pas être simulée. Concevoir un adaptateur de fournisseur, vérifier les notifications serveur, contrôler signature, idempotence et rapprochement avant d’activer l’encaissement automatique. Tant qu’un fournisseur réel n’est pas choisi et testé, les comptes pilotes peuvent être activés manuellement avec traçabilité, sans afficher un paiement fictif comme encaissé.

# 5. Règles métier transverses

| **Réf.** | **Règle**                                                                | **Conséquence technique / test**                                           |
|----------|--------------------------------------------------------------------------|----------------------------------------------------------------------------|
| RG-01    | Tous les montants métier sont des entiers XOF.                           | Validation serveur ; pas de nombres flottants pour les calculs financiers. |
| RG-02    | Un ticket finalisé est unique et rejouable sans doublon.                 | Clé d’idempotence tenant + transaction atomique.                           |
| RG-03    | Les paiements d’un ticket totalisent exactement le net dû.               | Refus des paiements incomplets ou excédentaires non justifiés.             |
| RG-04    | Seule la part espèces modifie la caisse physique.                        | Rapprochement par mode de paiement.                                        |
| RG-05    | Les sorties de stock sont dérivées des lignes vendues/consommées.        | Calcul stock et CUMP par le serveur ; rollback global si erreur.           |
| RG-06    | Les prix historiques restent figés sur les tickets.                      | Snapshot de ligne ; pas de recalcul rétroactif du CA.                      |
| RG-07    | Une correction ne détruit pas l’historique.                              | Annulation, remboursement et ajustement en écriture inverse.               |
| RG-08    | Le tenant est résolu depuis la session et les memberships.               | RLS forcée ; test inter-tenant systématique.                               |
| RG-09    | Les données en attente de sync sont distinctes des données confirmées.   | État pending_sync/confirmed et interface explicite.                        |
| RG-10    | Un rendez-vous n’est pas obligatoire pour encaisser.                     | Feature flag et test du parcours caisse quand Agenda désactivé.            |
| RG-11    | Les achats de stock ne sont pas doublés en charges générales.            | Lien explicite achat-stock ↔ dépense / mouvement.                          |
| RG-12    | L’abonnement contrôle l’accès aux modules, pas la propriété des données. | Suspension non destructive ; export/consultation de récupération.          |

# 6. Modèle de données cible

Le modèle existant doit être étendu à partir des entités présentes plutôt que remplacé. Les tables historiques et les contrats Dexie/synchronisation doivent être protégés par des migrations rétrocompatibles.

## 6.1 Entités métier à conserver

| **Entité / modèle existant**                 | **Rôle dans la cible**                                                      |
|----------------------------------------------|-----------------------------------------------------------------------------|
| SalonInfo / AppSettings / CategoryItem       | Identité de l’établissement, préférences et catégories configurables.       |
| ServiceCatalogItem / ServicePriceVariant     | Catalogue de prestations, variantes, prix, durée et consommables standards. |
| Employee                                     | Collaborateurs, fonctions et règles de commission.                          |
| RevenueEntry / TicketPaymentSplit            | Lignes de recettes et répartition des modes de paiement.                    |
| CashSession / CashMovement                   | Sessions et mouvements de caisse espèces.                                   |
| ProductItem / StockMovement                  | Stock produits/consommables et journal de mouvements.                       |
| ExpenseEntry / RecurringExpense              | Dépenses et charges fixes.                                                  |
| AdvanceEntry / BonusEntry / SalaryPayment    | Avances, primes et paiements de rémunération.                               |
| BudgetTarget / CorrectionLog                 | Objectifs et journal de correction.                                         |
| Organization / Tenant / Membership / Session | Frontière SaaS, appartenance, rôles et authentification.                    |

## 6.2 Entités à ajouter

| **Entité à ajouter**                      | **Champs / règles minimales**                                                                                                           |
|-------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| Client                                    | id, tenant_id, display_name, phone?, email?, preferences?, note?, created_at, updated_at, archived_at? ; index téléphone normalisé.     |
| Supplier                                  | id, tenant_id, name, phone?, email?, address?, notes?, active, created_at, updated_at.                                                  |
| Purchase / PurchaseLine                   | fournisseur, référence, date, statut, mode de règlement, lignes produit, quantité reçue, coût unitaire, total ; effets stock atomiques. |
| Appointment (optionnel)                   | client_id?, service_id/variant?, employee_id?, starts_at, ends_at, status, note, source, created_by.                                    |
| CheckoutIdempotency / CheckoutCommand     | tenant_id, idempotency_key unique, request_hash, canonical_result, processed_at ; protection contre double envoi.                       |
| Subscription / Plan / SubscriptionPayment | entités globales plateforme : plan, quotas, dates, état, transaction externe, facture et historique.                                    |
| PlatformAuditLog                          | acteur plateforme, action, entité, avant/après, motif, date, corrélation.                                                               |

Les rendez-vous peuvent être ajoutés dans une migration dédiée, seulement lorsque la décision de les livrer est prise. Les tables d’abonnement et de paiement SaaS doivent être isolées de la comptabilité métier des salons : le paiement d’un ticket client et le paiement de l’abonnement au logiciel sont deux flux distincts.

## 6.3 Évolution des modèles TypeScript

- Ajouter Client, Supplier, Purchase, PurchaseLine, Appointment, Subscription, Plan et CheckoutCommand dans les domaines concernés.

- Ne pas stocker un simple clientName comme unique identité CRM : conserver clientId optionnel et snapshot du nom sur le ticket si nécessaire.

- Créer des DTO de commande/lecture distincts des objets Dexie persistés lorsque le contrat serveur diffère.

- Maintenir une version de schéma IndexedDB et une procédure de reprise non destructive pour les bases déjà installées.

# 7. Audit de l’existant et décisions de conservation

## 7.1 Socle technique constaté

| **Couche**         | **État constaté**                                                                                               | **Décision**                                                                                                       |
|--------------------|-----------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| Frontend           | React 19, TypeScript, Vite 8, React Router 7.                                                                   | Conserver ; aucune migration Next.js nécessaire.                                                                   |
| UI / visualisation | Framer Motion, Lucide React, Recharts.                                                                          | Conserver ; harmoniser l’interface et limiter les animations aux interactions utiles.                              |
| Persistance locale | IndexedDB via Dexie 4.4 ; bases locales partitionnées par salon/compte/rôle d’après le suivi.                   | Conserver ; protéger la migration/reprise et tester les profils réels.                                             |
| API / serveur      | Couche API Node, gestion Vite locale et routes de déploiement.                                                  | Conserver ; ajouter des commandes métier explicites au lieu de tout faire passer par sync.                         |
| Données cloud      | PostgreSQL privé \`salon_pro\`, migrations et RLS ; connexion Supabase privilégiée côté serveur selon le guide. | Conserver le projet Supabase actuel comme cible opérationnelle ; clarifier les références Neon encore dans README. |
| Tests              | Vitest, Testing Library, jsdom, fake-indexeddb, PGlite.                                                         | Conserver ; compléter avec E2E navigateur et PostgreSQL hébergé multi-connexion.                                   |

## 7.2 Modules à conserver sans réécriture

| **Module / dossier**                                           | **Action**                                                                                       |
|----------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| src/features/dashboard                                         | Conserver ; aligner les KPIs sur les écritures serveur validées.                                 |
| src/features/cash                                              | Conserver ; connecter ouverture/clôture au nouveau flux autoritaire.                             |
| src/features/revenue                                           | Conserver l’interface ticket ; remplacer l’enregistrement final par la commande serveur unifiée. |
| src/features/services                                          | Conserver ; compléter validation serveur des tarifs/variantes et consommables.                   |
| src/features/inventory                                         | Conserver ; réutiliser les mouvements et le CUMP ; ajouter fournisseurs/achats si absents.       |
| src/features/expenses                                          | Conserver ; vérifier la liaison avec achats et paie.                                             |
| src/features/employees + payroll                               | Conserver ; durcir permissions et fiabiliser les calculs de commission.                          |
| src/features/reports + budget                                  | Conserver ; corriger les sources et les rapprochements après finalisation du checkout.           |
| src/features/settings + auth                                   | Conserver ; compléter onboarding, gestion des membres et configuration des modules.              |
| src/db + contexts + hooks                                      | Conserver ; ne modifier que les contrats nécessaires au nouveau flux.                            |
| server/authEngine.ts, sessions, tenancy, sync, cashierStock.ts | Conserver ; ajouter de nouvelles fonctions dédiées, éviter de diluer les contrôles de sécurité.  |

## 7.3 Écarts à traiter

| **Écart**                                                                                                               | **Priorité**  | **Traitement**                                                         |
|-------------------------------------------------------------------------------------------------------------------------|---------------|------------------------------------------------------------------------|
| Checkout serveur incomplet : prix, variantes, remises, paiements, caisse, reçu et parcours Gérant/Caissier non unifiés. | P0            | Créer une commande d’encaissement serveur atomique et idempotente.     |
| Pas de modèle Client CRM dédié identifié.                                                                               | P1            | Créer Client et relier les tickets avec compatibilité legacy.          |
| Fournisseurs/achats non identifiés comme domaine autonome complet.                                                      | P1            | Ajouter fiches fournisseurs et réceptions d’achat simples.             |
| Création autonome d’organisation/salon et assistant d’onboarding manquants.                                             | P0 SaaS       | Compléter la création atomique et la première configuration.           |
| Plans, abonnements, paiement récurrent et console plateforme absents/incomplets.                                        | P0 commercial | Construire le control plane et le cycle de vie abonnement.             |
| Rendez-vous absent comme module métier dédié.                                                                           | P2            | Ajouter après le cœur ERP, sous feature flag désactivé par défaut.     |
| Recette hébergée HTTPS et vraie concurrence multi-postes non démontrées.                                                | P0 production | E2E contre Supabase hébergé avec deux sessions et plusieurs appareils. |
| Documentation incohérente Neon/Supabase et audit ancien.                                                                | P1 qualité    | Établir une source documentaire unique et dater les états.             |

État de référence : IMPLEMENTATION_PROGRESS.md documente 118/118 tests sur 23 fichiers à l’étape 9 ; les étapes précédentes y décrivent des contrôles d’authentification, tenancy, sessions, delta sync et PWA. Ce nombre est un état rapporté par le dépôt au moment de l’audit, et non un résultat de test exécuté indépendamment dans cette mission.

# 8. Architecture cible et principes de refonte

## 8.1 Architecture logique

| **Bloc**                      | **Responsabilité cible**                                                                                                      |
|-------------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| Application React / Vite      | Écrans métier, formulaires, tableau de bord, agenda optionnel, navigation et feedback de synchronisation.                     |
| Domain / application services | Calculs métier testables, règles de ticket, permissions, validation et orchestration des cas d’usage.                         |
| IndexedDB / Dexie             | Cache local, espace de travail isolé, file d’opérations en attente et état PWA ; pas une source d’autorité financière finale. |
| API serveur                   | Authentification, tenant, contrôle RBAC, commandes métier atomiques, synchronisation et projections de lecture.               |
| PostgreSQL privé / Supabase   | Source de vérité cloud, migrations, transactions, RLS, journal de révisions et données métier.                                |
| SaaS control plane            | Organisations, plans, souscriptions, paiements de logiciel, quotas et administration plateforme, séparés des ventes du salon. |

## 8.2 Principes d’implémentation

- Pas de remplacement de Vite/React par Next.js dans le périmètre de cette refonte.

- Pas de migration de base de données sans besoin démontré ; ajouter les migrations successives 006, 007, etc. de façon additive.

- Pas d’accès direct navigateur aux tables privées ; toute mutation passe par API serveur et autorisation.

- Le serveur est autoritaire sur les calculs financiers, le stock, les sessions et les droits.

- Le moteur de synchronisation transporte et réconcilie des données autorisées ; il ne remplace pas les commandes métier transactionnelles.

- Les composants UI existants sont gardés, puis harmonisés par petites touches ; pas de redesign global avant fiabilisation du parcours caisse.

- Les nouvelles fonctions sont ajoutées dans des dossiers features séparés, avec domaine, service, API, vues et tests.

## 8.3 Offline-first : règle de fonctionnement

Le mode hors ligne doit rester un avantage du produit, mais il ne doit pas produire de fausses confirmations serveur. Les opérations hors ligne sont conservées localement avec identifiants stables et un état explicite « en attente de synchronisation ». Au retour du réseau, le serveur valide et acquitte les opérations de manière idempotente. Pour un ticket créé hors ligne, utiliser une référence locale provisoire ; le numéro officiel, si séquencé côté serveur, n’est confirmé qu’après acceptation. Les écrans doivent expliquer clairement ce qui est local, en attente ou confirmé.

Le cache précaché PWA ne constitue pas une sauvegarde des données métier. Les espaces Dexie séparés par compte/rôle sont une isolation applicative logique ; le suivi indique qu’ils ne remplacent pas des profils OS/navigateur séparés lorsque plusieurs personnes partagent physiquement un poste.

## 8.4 Documentation et cible de déploiement

- Décider et documenter un chemin unique de déploiement (par exemple Vercel + PostgreSQL/Supabase), puis retirer les instructions obsolètes ou les placer dans une section migration.

- Aligner README.md, .env.example, SUPABASE_SETUP.md, scripts de migration et variables d’environnement.

- Distinguer clairement les secrets serveur des variables exposées au navigateur ; aucun secret DB/Auth dans les variables publiques Vite.

- Ajouter une procédure de restauration testée et une procédure de retour arrière pour chaque release de schéma.

# 9. Plan précis de refonte et de finalisation

L’ordre ci-dessous privilégie la sécurisation de l’argent et du stock avant l’ajout de nouveaux écrans. Chaque lot doit être livré sur une branche courte, testé, relu et fusionné sans casser le fonctionnement offline ni les anciens comptes.

## Lot 0 — Geler la référence et établir la baseline

Objectif : protéger l’existant avant modification.

- Créer un tag de référence et une branche de travail dédiée ; relever commit, scripts, migrations 001–005 et variables documentées.

- Exécuter db:schema:check, lint, tests et build ; archiver rapports et résultats CI.

- Réaliser une sauvegarde vérifiée de la base Supabase et un export local test de données Dexie représentatives.

- Cartographier les flux actuels Gérant, Caissier, recette, caisse, stock, dépense et sync ; identifier les appels réellement utilisés par l’UI.

- Constituer une matrice de non-régression pour chaque module déjà fonctionnel.

Livrables : baseline reproductible, schéma des flux, inventaire des endpoints, jeux de données anonymisés et plan de rollback.

## Lot 1 — Encaissement serveur unifié et autoritaire (P0)

Objectif : terminer le point faible central signalé à l’étape 9.

Zones de code candidates : server/apiHandler.ts, server/cashierStock.ts, moteur de synchronisation et ses contrats, src/features/revenue, src/features/cash, src/domain/models/index.ts ; migration additive si nécessaire.

- Définir une commande CheckoutCommand commune Gérant/Caissier : lignes, identifiants catalogue, variante, quantité, employé, client optionnel, remise, moyens de paiement et clé d’idempotence.

- Lire côté serveur les prix et statuts actifs du catalogue ; contrôler variantes, droits, limites de remise et cohérence des lignes.

- Recalculer sous transaction le brut, remises, total net, paiements fractionnés, monnaie rendue et part espèces.

- Vérifier l’existence d’une session de caisse si le mode de fonctionnement l’exige ; produire les mouvements en espèces correspondants.

- Dériver stock de revente et consommables ; appliquer CUMP/mouvements et rollback complet si une seule ligne est invalide.

- Générer un reçu unique tenant-scoped et un snapshot immuable du ticket ; mémoriser le résultat canonique pour les rejeux.

- Retourner au client l’écriture serveur normalisée et faire acquitter la base Dexie sans créer de faux conflit.

- Basculer l’interface Gérant puis Caissier sur ce même cas d’usage, sans supprimer les composants de saisie actuels.

Critères de sortie : prix manipulé rejeté ; sommes exactes ; stock atomique ; double clic/rejeu sans doublon ; numérotation unique ; aucune différence de calcul entre Gérant et Caissier ; tous les tests du flux passent sur PostgreSQL transactionnel.

## Lot 2 — Annulations, retours, remboursements et rapprochement

- Créer les commandes serveur de void/refund/correction avec autorisation Gérant ou permission spécifique.

- Réintégrer stock et consommables selon les lignes annulées ; conserver un lien vers le ticket source et le mouvement inverse.

- Gérer les remboursements par mode de paiement sans fabriquer de mouvement espèces si la transaction d’origine était Wave ou autre.

- Rendre les rapports, dashboard, commission et historique client cohérents avec les tickets annulés/remboursés.

- Ajouter des motifs obligatoires, auteur, date, état d’approbation et journal avant/après.

Critères de sortie : une annulation ne supprime pas l’historique ; un remboursement partiel est rapproché au ticket ; les totaux de caisse et rapports se recalculent correctement.

## Lot 3 — Validation réelle du socle SaaS, sync et PWA

- Configurer un environnement de recette Supabase distinct de la production, avec les vrais secrets serveur conservés dans le gestionnaire de secrets du déploiement.

- Exécuter les parcours navigateur ↔ API hébergée ↔ PostgreSQL : création, login, refresh, logout, push, pull, caisse et stock.

- Tester deux sessions et deux appareils sur le même tenant, puis deux tenants distincts avec mêmes identifiants d’entités.

- Tester la concurrence simultanée sur une dernière unité de stock, les doublons de requête, les conflits delta et les retours réseau.

- Faire la recette PWA sur Chrome desktop et mobile ; vérifier installation, cache shell, mise à jour et reconnexion.

- Ajouter alertes techniques, logs corrélés, métriques d’erreurs et procédure de support.

Critères de sortie : aucune fuite inter-tenant ; pas de double vente ni stock négatif sous concurrence ; refresh/révocation vérifiés dans navigateur réel ; aucun faux statut de synchronisation confirmée.

## Lot 4 — Onboarding d’organisation / salon et administration des membres

Zones candidates : server/authEngine.ts, routes utilisateurs/auth, src/features/auth, src/features/settings, migrations additives et configuration initiale.

- Ajouter une route dédiée de création initiale organisation + tenant + membership propriétaire dans une transaction.

- Empêcher la création répétée et protéger l’email global, l’appartenance et le rôle du propriétaire.

- Créer un assistant d’installation : nom, type d’établissement, logo/coordonnées, catégories, prestations de départ, employés et stock initial facultatif.

- Permettre au gérant d’inviter/provisionner un Caissier avec statut, réinitialisation et révocation.

- Ajouter une page de changement de salon seulement si le modèle le permet réellement ; sinon afficher clairement le tenant actif.

- Compléter les tests 401/403 et les projections par rôle.

Critères de sortie : un nouveau client peut créer son premier salon sans intervention SQL ; les données de départ sont rattachées au tenant ; les utilisateurs n’accèdent qu’à leur périmètre.

## Lot 5 — CRM client léger et fournisseurs / achats

Zones candidates : nouveaux dossiers src/features/clients et src/features/suppliers (ou purchasing), src/domain/models, dépôt Dexie, API serveur, migrations additives et synchronisation.

- Ajouter les modèles et tables Client, Supplier, Purchase et PurchaseLine avec index tenant-scoped.

- Créer une UI client simple : recherche, fiche, historique, création rapide depuis ticket et client comptoir.

- Créer un carnet fournisseur et un flux achat/réception de stock minimal relié au CUMP et aux dépenses.

- Veiller à la projection Caissier : ne transmettre que les champs client nécessaires à l’encaissement.

- Mettre à jour exports, rapports, sauvegarde/restauration et migration des anciennes lignes clientName.

Critères de sortie : l’ancien historique clientName reste lisible ; les ventes anonymes fonctionnent ; les achats alimentent le stock sans double dépense ; aucune donnée CRM d’un autre tenant n’est visible.

## Lot 6 — Plans, abonnements et console plateforme

Zones candidates : nouveau control plane / espace de routes plateforme, schéma global dédié ou tables globales strictement contrôlées, nouveaux dossiers UI d’administration.

- Définir les plans, quotas et feature flags dans des tables configurables.

- Créer le modèle subscription et son cycle de vie, avec historique non destructif.

- Créer une console super-administrateur séparée des routes Gérant/Caissier.

- Appliquer les quotas côté API et serveur (comptes, modules, établissements), pas seulement dans l’UI.

- Créer facture SaaS et échéancier de facturation distincts du ticket client du salon.

- Journaliser les activations manuelles, suspensions, changements de plan et actions de support.

Critères de sortie : la création et le suivi d’un abonnement sont testés ; suspension n’efface aucune donnée ; quotas validés côté serveur ; accès plateforme strictement séparé.

## Lot 7 — Paiement réel des abonnements

- Choisir le prestataire en fonction du pays, des moyens disponibles, frais, réconciliation et capacité de paiement récurrent.

- Créer un adaptateur serveur et stocker seulement les références nécessaires du prestataire.

- Vérifier signature, timestamp, état final et idempotence des webhooks ; ne jamais faire confiance au retour navigateur.

- Gérer paiement réussi, en attente, échoué, remboursé et contesté.

- Ajouter rapprochement financier et alertes d’échec ; garder une procédure manuelle contrôlée.

Critères de sortie : aucun paiement simulé en production ; chaque abonnement actif correspond à une confirmation serveur vérifiable ou à une activation manuelle auditée.

## Lot 8 — Rendez-vous optionnels

- Ajouter un feature flag par tenant et contrôle de plan.

- Créer Appointment, règles de disponibilité simples et affichage jour/semaine.

- Connecter rendez-vous aux fiches clients et prestations.

- Ajouter états, conflits horaires et conversion vers ticket.

- Garder notifications WhatsApp/SMS et réservation publique hors périmètre initial.

Critères de sortie : agenda activable/désactivable ; aucun impact sur la caisse ; conversion rendez-vous → ticket sans doublon ni ressaisie.

## Lot 9 — Finition, performance et mise en production

- Effectuer une revue UX des parcours quotidiens : connexion, ouverture caisse, ticket, reçu, clôture, achat stock et rapport.

- Réduire le poids du bundle et charger graphiques/écrans secondaires à la demande si nécessaire.

- Uniformiser terminologie française, états vides, erreurs, confirmations, responsive et accessibilité clavier.

- Finaliser sauvegardes automatiques, rétention, test de restauration, monitoring et procédure d’incident.

- Configurer les protections de branche GitHub et rendre lint/tests/build/schema-check obligatoires.

- Publier une version pilote limitée, collecter les retours, puis ouvrir les inscriptions publiques.

Critères de sortie : checklist Go/No-Go entièrement validée, restauration prouvée, pas de défaut bloquant sur caisse/stock/auth/tenant, support et surveillance actifs.

# 10. Carte de modifications du repository

| **Chemin / zone**                                          | **Action ciblée**                                                                            | **Précaution**                                                                        |
|------------------------------------------------------------|----------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| src/domain/models/index.ts                                 | Ajouter types CheckoutCommand/Result, Client, Supplier, Purchase, Appointment et DTO utiles. | Éviter de casser les modèles Dexie existants ; migration et compatibilité explicites. |
| src/features/revenue                                       | Réutiliser UI ticket et passer par Checkout use case/API.                                    | Pas de réécriture visuelle globale.                                                   |
| src/features/cash                                          | Relier la caisse à la réponse canonique serveur et aux remboursements.                       | Conserver billetage, clôture et impressions déjà présents.                            |
| src/features/inventory                                     | Relier achat/réception et mouvements autoritaires ; ajouter écrans fournisseurs.             | Réutiliser CUMP et mouvements existants.                                              |
| src/features/clients (nouveau)                             | CRM léger et historique des visites.                                                         | Client facultatif ; migration de clientName.                                          |
| src/features/appointments (nouveau, optionnel)             | Agenda jour/semaine, statuts, liens au ticket.                                               | Feature flag désactivé par défaut.                                                    |
| src/features/suppliers ou purchasing (nouveau)             | Fournisseurs, achats, réceptions.                                                            | Éviter double comptabilisation via expenses.                                          |
| src/features/auth + settings                               | Onboarding organisation/tenant, membres et statut abonnement.                                | Pas de tenantId fourni librement par le navigateur.                                   |
| server/apiHandler.ts + nouveaux services server/checkout\* | Routes explicites de checkout, annulation, remboursement et onboarding.                      | Transactions, autorisation et idempotence dans le serveur.                            |
| server/cashierStock.ts                                     | Réutiliser les règles stock ; extraire en service de domaine partagé si nécessaire.          | Ne pas dupliquer les calculs Gérant/Caissier.                                         |
| src/db + contexts + hooks                                  | Étendre schéma Dexie, espaces, état pending/confirmed et opérations idempotentes.            | Reprise non destructive ; tester bases historiques et profils.                        |
| supabase/migrations/006+                                   | Ajouter tables/contraintes CRM, checkout et achats ; ensuite SaaS/agenda selon lot.          | Migrations additives, parité db/schema et rollback documenté.                         |
| README.md / SUPABASE_SETUP.md / .env.example               | Aligner fournisseur DB, variables, déploiement et état réel des modules.                     | Une seule source de vérité ; aucun secret dans Git.                                   |
| .github/workflows                                          | Renforcer CI et branch protection.                                                           | La CI ne remplace pas la recette hébergée.                                            |

# 11. Stratégie de tests et critères de sortie

## 11.1 Pyramide de tests

| **Niveau**               | **À couvrir**                                                                 | **Outils / environnement**                                    |
|--------------------------|-------------------------------------------------------------------------------|---------------------------------------------------------------|
| Tests unitaires          | Calcul prix, remises, CUMP, commissions, statuts, droits et transitions.      | Vitest ; tests déterministes.                                 |
| Tests intégration API/DB | Checkout atomique, idempotence, RLS, transactions, migrations et projections. | PGlite pour tests rapides + PostgreSQL/Supabase de recette.   |
| Tests frontend           | Ticket, caisse, formulaires, affichage offline, rôles et erreurs.             | Testing Library, user-event, fake-indexeddb.                  |
| Tests E2E                | Connexion, vente, reçu, clôture, achat, client, agenda activé/désactivé.      | Navigateur réel en HTTPS ; scénarios multi-profils.           |
| Tests concurrence        | Deux caissiers vendent le même stock ; rotations de sessions ; conflits sync. | Vraies connexions PostgreSQL simultanées.                     |
| Tests opérationnels      | Backup/restore, monitoring, déploiement, rollback, PWA.                       | Projet Supabase de recette et environnement de préproduction. |

## 11.2 Portes de validation non négociables

- P0 Checkout : ticket complet et aucun effet partiel en cas d’échec.

- P0 Isolation : tests positifs/négatifs entre deux tenants, sans lecture ni écriture croisée.

- P0 Sécurité : refresh, révocation et changement de rôle testés en navigateur réel.

- P0 Données : sauvegarde et restauration vérifiées sur une base non vide.

- P0 Multi-postes : opérations concurrentes et dernière unité de stock.

- P1 SaaS : création autonome d’établissement, activation de plan et quotas.

- P1 Commercial : paiement abonnement réel vérifié par webhook ou activation manuelle tracée.

- P2 Agenda : disponibilité du module et conversion ticket testées sans dépendance du cœur ERP.

## 11.3 Définition of Done pour tout lot

- Règle métier documentée et approuvée ; migration réversible ou procédure de restauration documentée.

- Types, validations serveur et messages d’erreur définis ; aucune autorisation uniquement côté UI.

- Tests unitaires + intégration correspondants ajoutés ; tests existants préservés.

- Lint, tests, schema:check, build et git diff --check passent.

- Pas de régression sur offline, sync, permissions ni données historiques.

- Documentation et changelog mis à jour ; code relu et prêt à fusionner.

# 12. Hors périmètre de la première version commerciale

- Marketplace de réservation, comparateur public de salons, profils publics et paiement de réservation en ligne.

- Application native mobile indépendante ; la PWA responsive est la cible de départ.

- Comptabilité générale à partie double, déclarations fiscales et module FNE certifié.

- Gestion RH complète : présence biométrique, congés, contrats et déclarations sociales.

- Gestion multi-sites complexe avec transfert de stock inter-branches et consolidation groupe ; à traiter après validation d’un salon mono-tenant.

- Notifications automatisées WhatsApp/SMS et campagnes marketing ; phase ultérieure.

- Prévisions IA et recommandations automatiques ; seulement après données fiables et volume suffisant.

Une éventuelle intégration FNE ou une fonction fiscale doit faire l’objet d’un cadrage réglementaire séparé, vérifié à la date d’implémentation, sans la présenter comme une simple fonctionnalité d’impression de reçu.

# 13. Conditions de lancement et indicateurs

## 13.1 Go / No-Go commercial

| **Condition**       | **GO si…**                                                                                        |
|---------------------|---------------------------------------------------------------------------------------------------|
| Fiabilité de caisse | Les tickets, paiements fractionnés, espèces et annulations sont rapprochés sans écart inexpliqué. |
| Stock               | Les sorties sont atomiques, les achats alimentent le stock, les corrections sont auditées.        |
| Sécurité            | Isolation tenant testée, permissions Caissier/Gérant validées, sessions révocables.               |
| Offline             | Les états pending/confirmed sont compréhensibles et les rejeux ne créent pas de doublons.         |
| SaaS                | Un nouveau salon peut s’inscrire, être provisionné et recevoir un plan.                           |
| Facturation         | Un abonnement est payé par un prestataire réel ou activé manuellement avec preuve et audit.       |
| Exploitation        | Backup/restauration, monitoring, support et rollback disponibles.                                 |

## 13.2 Indicateurs à suivre après pilote

- Taux de tickets finalisés sans correction manuelle.

- Écart moyen entre caisse théorique et caisse comptée.

- Taux de synchronisation réussie et âge maximal d’une opération en attente.

- Nombre de mouvements de stock corrigés après vente.

- Nombre d’erreurs de paiement / tickets doublons / erreurs de reçu.

- Taux d’activité des salons, renouvellement abonnement, échecs de paiement et support par salon.

# 14. Décisions à prendre avant exécution

| **Décision**                | **Proposition par défaut**                                                    | **Pourquoi**                                                                                     |
|-----------------------------|-------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| Base cloud de référence     | Supabase/PostgreSQL privé déjà utilisé dans le suivi de déploiement.          | Éviter de changer de fournisseur pendant la finalisation ; harmoniser les docs Neon résiduelles. |
| Périmètre premier lancement | Un établissement par compte client au départ ; architecture tenant préservée. | Réduire les cas de gestion multi-sites.                                                          |
| Plans SaaS                  | Deux plans configurables sans prix figés dans le code.                        | Suffisant pour tester le modèle commercial.                                                      |
| Paiement abonnement         | Choix fournisseur après étude des frais, disponibilité CI et webhooks.        | Ne pas simuler un paiement réel.                                                                 |
| Rendez-vous                 | Feature flag désactivé par défaut, activable par gérant/plan.                 | Respect du choix optional et protège la simplicité du produit.                                   |
| Client CRM                  | Fiche légère et client facultatif à la vente.                                 | Ne pas ralentir l’encaissement comptoir.                                                         |
| Comptabilité / FNE          | Hors périmètre MVP, étude réglementaire séparée.                              | Éviter les promesses légales non vérifiées.                                                      |

# Conclusion et ordre de priorité

SALON PRO ne doit pas être reconstruit. Le repository fournit déjà une base technique et des modules métier substantiels. La trajectoire la plus sûre est de consolider d’abord l’encaissement serveur (P0), de prouver la sécurité et le fonctionnement hébergé multi-postes, puis d’ajouter les éléments réellement manquants : onboarding commercial, CRM léger, fournisseurs/achats et abonnements. Le calendrier de rendez-vous est livré en dernier et reste optionnel.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Ordre recommandé</strong></p>
<p>1) Checkout serveur complet → 2) annulations / rapprochements → 3) recette Supabase multi-postes → 4) onboarding &amp; RBAC → 5) CRM + fournisseurs → 6) abonnements &amp; console plateforme → 7) paiement réel → 8) agenda optionnel → 9) lancement pilote.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

*Le succès de SALON PRO dépendra moins du nombre d’écrans que de la confiance accordée aux chiffres : un ticket doit être juste, un paiement doit se rapprocher, une caisse doit être explicable, un stock doit être cohérent et un salon ne doit jamais voir les données d’un autre.*

# Références techniques consultées

Audit effectué sur la branche main du repository public ErwinssKoffi/barbershop. Le dernier commit de branche observé pendant la consultation est cecb99dc7b784072b9f7a4075d8f664772d96bf5, fusionné le 31 octobre 2026 à 04:37 UTC.

- Repository et commit de référence : https://github.com/ErwinssKoffi/barbershop/commit/cecb99dc7b784072b9f7a4075d8f664772d96bf5

- Documentation examinée : README.md, IMPLEMENTATION_PROGRESS.md et ANALYSE_COMPLETE.md (dossier racine du repository).

- Stack et domaine : package.json et src/domain/models/index.ts.

- Modules applicatifs : src/features/ ; architecture serveur : server/ et api/.

- Schéma et migrations PostgreSQL : supabase/migrations/ ; guide de configuration : SUPABASE_SETUP.md.

- Recette PWA : PWA_TESTING.md.

Limite : audit documentaire GitHub, sans exécution locale ni recette hébergée HTTPS/DB ; confirmer ces points avant production.
