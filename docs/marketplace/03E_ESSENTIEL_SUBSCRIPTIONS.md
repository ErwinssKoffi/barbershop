# PROMPT 03E — Politique ESSENTIEL et consultation des abonnements

1er novembre 2026. React/TypeScript/Vite conservé. **Politique, modèle et consultation livrés ; activation plateforme et application aux commandes publiques non livrées.**

## Décisions produit confirmées par l’utilisateur

Une seule offre validée à ce stade : **SALON PRO ESSENTIEL — 4 900 XOF par mois glissant**.

| Capacité | Règle validée |
| --- | --- |
| Établissements | 1 |
| Comptes | 2 : 1 Gérant + 1 Caissier |
| Fiches collaborateurs | 5 |
| ERP inclus | Caisse/recettes, dépenses, catalogue de prestations, stock standard, rapports essentiels |
| Profil public | Inclus |
| Galerie | 3 photos |
| Prestations visibles | 10 |
| Contacts | Téléphone et WhatsApp |
| Demandes | Contact et rendez-vous à confirmer par le salon |
| Réservation automatique | Non accordée |

La grille envoyée initialement était tronquée ; l’utilisateur a ensuite complété ESSENTIEL. Aucun autre forfait/prix n’est déduit de la comparaison concurrentielle fournie. Les affirmations concurrentielles ne sont pas vérifiées par ce lot et ne servent pas de données runtime.

**Période :** mois calendaire glissant, même heure locale du salon, dernier jour du mois cible si le jour n’existe pas. Le jour d’ancrage original reste conservé : 31 janvier → 28/29 février → 31 mars. Pas un simple ajout de 30 jours ni un renouvellement calculé depuis la date déjà tronquée.

**Grâce :** trois jours (72 heures écoulées après l’échéance), fiche déjà publiée maintenue, mais nouvelles publications, uploads et demandes publiques refusés. Puis plus de droit de visibilité. Les contacts directs téléphone/WhatsApp d’une fiche existante ne sont pas une création de demande dans l’API ; le système ne peut empêcher une conversation externe. Les données, la caisse et les rendez-vous existants sont préservés.

**Activation :** manuelle, auditée, après vérification externe réelle par un opérateur plateforme autorisé. Ni activation par le Gérant, ni paiement supposé après retour navigateur. Pas d’essai, remise, grâce supplémentaire, renouvellement automatique ou remboursement inventé.

## Implémentation domaine

`src/domain/subscriptions.ts` :

- définition commerciale versionnée ESSENTIEL_V1, sans enregistrement automatique de forfait/souscription ;
- entitlements typés et complets, quotas entiers bornés et booléens stricts ;
- calcul actif / à venir / grâce / expiré / révoqué / suspendu / absent, bornes de fin exclusives ; refus par défaut ;
- pendant la grâce : maintien de visibilité seulement, pas de nouveaux droits de mutation/demande ;
- calcul mensuel à partir de l’ancrage initial et du fuseau, avec contrôle des fins de mois et années bissextiles ;
- rejet des heures locales inexistantes ou ambiguës lors d’une transition DST : examen opérateur requis, pas de décalage silencieux.

Les quotas calculés ne constituent **pas** une réservation atomique de capacité. Ils ne sont pas appliqués aux données ERP historiques dans cette tranche. Les collaborateurs/comptes réels excédant ces limites ne sont ni supprimés ni bloqués rétroactivement. Les contrôles futurs sur nouvelles créations devront être explicites, transactionnels et préserver l’accès aux données existantes.

## Migration 019

`019_saas_subscriptions`, indépendante des migrations optionnelles 006–018 :

- `saas_plans` : catalogue global de versions immuables, prix entier XOF, période calendar_month, durée de grâce explicite et entitlements JSONB validés. Le catalogue est global par nature, sans données privées d’un salon : pas de tenant_id artificiel. Une nouvelle version exige une nouvelle ligne ; aucun UPDATE/DELETE.
- `tenant_subscriptions` : FK tenant et plan, clé d’activation UUID, ancrage/fuseau/index de période persistés, bornes finies, montant attesté, références externes/de preuve/opérateur obligatoires. Pas de statut commercial stocké qui deviendrait obsolète sans cron.
- `subscription_events` : activation/enregistrement et révocation transactionnels, acteur SQL et référence opérateur, journal immuable et FK composite tenant/souscription.

Le trigger vérifie le prix du plan, la grâce, les bornes mensuelles depuis l’ancrage et le fuseau courant du tenant lors de l’enregistrement. Il verrouille le tenant avant de refuser les chevauchements de périodes payées non révoquées. Les périodes payées adjacentes sont autorisées, même si la grâce précédente chevauche le renouvellement. La lecture privilégie la période active, puis la grâce, puis la prochaine période, puis le dernier historique.

L’ancrage et toutes les données d’activation sont immuables. Révocation unique, irréversible, avec opérateur et motif requis ; instant fixé en DB. Déduplication d’activation par tenant/clé et par tenant/référence externe. Pas de DELETE de souscription ou d’événement. L’échec d’audit annule l’enregistrement/la révocation.

La contrainte SQL valide le calcul calendaire PostgreSQL ; le rejet strict des ambiguïtés DST appartient également au futur service d’activation qui devra appeler le helper domaine. Un changement de fuseau entre deux périodes exige une politique d’examen opérateur : aucune migration silencieuse de l’ancrage historique.

ENABLE/FORCE RLS sur les trois tables. Runtime : lecture du catalogue global et des colonnes de période de son tenant uniquement. **Aucun droit de création/révocation de souscription.** Références externes/preuves/opérateurs et journal non lisibles par le runtime. Aucun accès PUBLIC/anon/authenticated ; grants par défaut navigateur révoqués et fonctions non exécutables par ces rôles. Événements insérés par trigger SECURITY DEFINER borné, search_path pg_catalog et tables qualifiées.

## Attestation, preuve et contrôle plateforme

Aucun forfait ni abonnement n’est inséré par la migration. ESSENTIEL_V1 est une **configuration commerciale approuvée**, pas un abonnement actif et pas une preuve de paiement. Le futur contrôle plateforme devra installer explicitement cette version exacte dans le catalogue avant toute activation.

Une référence de preuve en DB est une attestation, **pas la vérification de son contenu**. Les seules insertions/révocations exercées ici sont celles des fixtures de tests. Le propriétaire SQL reste privilégié et peut attester une identité opérateur : cela ne remplace pas un contrôle plateforme authentifié avec permissions, session, révocation, validation du justificatif et audit humain fiable. Aucun endpoint/CLI d’activation ou de paiement livré. Aucun secret opérateur/PIN/rôle métier fictif créé.

La déduplication est tenant-scoped ; l’absence de réutilisation frauduleuse d’une preuve entre salons et la vérification externe devront être assurées par ce futur contrôle. Aucun ledger de paiement plateforme ni webhook implémenté.

## Consultation fonctionnelle

Un panneau « Abonnement du salon » complète `/visibility`. Il affiche l’offre commerciale validée, avertit qu’elle n’est pas automatiquement active et permet de consulter l’état réellement enregistré. Dates affichées en ISO UTC explicite, sans conversion implicite navigateur. Erreur Cloud/migration absente → message, aucun abonnement local de remplacement.

`POST /api/visibility/subscription/read`, Gérant authentifié et tenant actif, corps vide. Horloge DB autoritaire, résolution des périodes et DTO privé sans justificatif, référence externe ou opérateur. La consultation est indépendante du flag d’édition SALON_VISIBILITY_ENABLED et des tables 009/016 ; elle requiert 019. Route protégée par les contrôles d’origine/rate limit/session du groupe Visibilité. Le client filtre les réponses d’un ancien espace/session.

**Les droits calculés ne sont pas encore raccordés aux commandes de publication, de médias ou de demandes publiques.** Le panneau de publication 03D reste volontairement fermé. Le gate public historique 009 ne consulte pas encore 019 : la fermeture automatique à échéance/grâce est donc une politique calculée/testée ici, pas un effet opérationnel annoncé sur les copies publiques existantes. Avant toute nouvelle publication, il faudra relier gate, droits et période de grâce sans dépendre d’un cron, réserver les quotas et recetter les effets de révocation.

Aucun achat, bouton d’activation, réservation automatique ou succès de paiement simulé. Aucun effet financier sur les ventes du salon, aucune utilisation de tenants.status pour un impayé commercial.

## Activation et repli

Opt-in `--include-subscriptions`, approbation SALON_MARKETPLACE_BACKUP_VERIFIED=true après sauvegarde/restauration effectivement vérifiées. Implique uniquement 001–005 + 019 ; anciens opt-ins inchangés. Snapshot/export optionnel alignés, aucune source historique réécrite. Le flag d’approbation n’exécute pas de sauvegarde et n’en constitue pas une preuve.

Aucune migration distante, configuration de provider, secret, déploiement, commit ou push. Configuration Cloud locale absente, recette hébergée non acquise. En repli, retirer la consultation ou revenir au logiciel précédent, conserver plans/grants/journaux ; aucun DROP/purge automatique. L’échec d’application annule la DDL 019 transactionnellement, testé.

## Validation obtenue

- **674/674 tests, 73 fichiers**, 588,40 s ; début 11:10:14 UTC le 1er novembre 2026.
- 21 nouveaux tests : 7 SQL/API, 11 politique/CLI, 2 UI, 1 registre. Isolation, permissions colonne, immutabilité, chevauchement, renouvellement adjacent, grâce/frontières, ancrage/année bissextile/DST, révocation, absence d’effet financier et rollback vérifiés.
- `npm run lint && npm test && npm run build` réussi ; lint 269 fichiers, zéro avertissement/erreur.
- Schéma/diff et hashes historiques disponibles 009–016 verts ; 017–018 non modifiées dans ce lot. Vérification complémentaire des fichiers non suivis/liens documentaires.
- Build : chunk principal 618,04 kB, gzip 183,62 kB ; avertissement >500 kB persistant.
- `db:check` : code 1, missing_configuration, checkoutReady/refundsReady false.
- Aperçu Vite 4173 `/visibility` HTTP 200, pas de recette Cloud HTTPS authentifiée ou capture visuelle prétendue.

PGlite ne prouve pas la concurrence réelle multi-connexion ni la vérification d’un paiement externe. Les tests UI simulent le transport. Plans/droits/souscriptions sont une fondation plus consultation, pas une plateforme SaaS de facturation terminée. **No-Go production maintenu.**

Avancement consigné dans `IMPLEMENTATION_PROGRESS.md` et décisions référencées dans [ADR-005](adr/ADR-005_ENTITLEMENTS.md). Prochain lot : contrôle plateforme d’activation authentifié et raccordement transactionnel des droits à la publication ; médias sécurisés ensuite, sans activation fictive.
