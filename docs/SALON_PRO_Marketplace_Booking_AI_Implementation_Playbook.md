# SALON PRO — Marketplace & Booking
## AI Development Playbook : cahier des charges fonctionnel, architecture cible et workflow d'implémentation

> **Version :** 1.0  
> **Date :** 1er novembre 2026  
> **Repository de référence :** <https://github.com/ErwinssKoffi/barbershop>  
> **Produit :** SALON PRO — ERP SaaS pour barbershops, salons de coiffure et instituts de beauté  
> **Périmètre de cette évolution :** portail public, annuaire de salons, fiches publiques, galerie média, réservation en ligne, agenda, abonnements, visibilité sponsorisée et intégration avec l'ERP existant.

---

# 0. Instructions de lecture et d'utilisation

Ce document constitue la référence de conception et d'implémentation de l'évolution **SALON PRO Marketplace & Booking**. Il est destiné à un agent de développement IA travaillant dans le repository existant avec Claude Code, Cursor ou un outil équivalent.

Il ne s'agit pas d'une demande de réécriture complète de SALON PRO. L'objectif est d'étendre progressivement le produit existant en préservant les modules métier, les données, les contrats déjà établis et les mécanismes de sécurité.

## 0.1 Règle d'exécution fondamentale

L'agent doit travailler **phase par phase**, dans l'ordre défini au chapitre 15. Il ne doit jamais interpréter ce playbook comme une autorisation de développer toutes les fonctionnalités en une seule opération.

Pour chaque phase :

1. Examiner le code réellement présent et les changements récents.
2. Lire les documents et conventions du repository.
3. Écrire un plan d'implémentation précis avant les changements significatifs.
4. Implémenter uniquement le périmètre de la phase courante.
5. Ajouter les migrations et les tests nécessaires, sans modifier destructivement les données existantes.
6. Exécuter les validations pertinentes.
7. Documenter les fichiers modifiés, les décisions, les limites et les résultats réels.
8. S'arrêter à la porte de validation de la phase. Ne pas commencer la suivante si les critères d'acceptation ne sont pas satisfaits.

## 0.2 Source de vérité et ordre de priorité

En cas de contradiction, appliquer l'ordre suivant :

1. Sécurité, intégrité des données, confidentialité et protection des transactions.
2. Code et schéma réellement présents dans le repository au moment de l'intervention.
3. Contrats API, migrations et documents techniques actuels du repository.
4. Exigences de ce playbook.
5. Préférences esthétiques ou hypothèses de l'agent.

L'agent ne doit jamais inventer l'état d'une fonctionnalité à partir de son nom, d'un ancien rapport ou d'une maquette. Il doit vérifier les composants, routes, modèles, tests et migrations qui existent réellement.

## 0.3 Règle de non-régression

- Ne pas réécrire la caisse, les recettes, les dépenses, le stock, le personnel, la paie, les rapports ou les paramètres pour construire la marketplace.
- Ne pas remplacer Dexie, PostgreSQL, l'authentification existante ou le système de synchronisation sans ADR approuvé et justification démontrée.
- Ne pas supprimer, réinitialiser ou remplacer les données d'un tenant.
- Ne pas modifier une migration déjà appliquée. Ajouter une migration nouvelle, additive et réversible autant que possible.
- Ne pas contourner les politiques RLS, les contrôles de tenant ou les règles d'autorisation pour accélérer les lectures publiques.
- Ne pas considérer une réussite de tests locaux comme une preuve de mise en production.

---

# 1. MASTER PROMPT — Instructions permanentes à l'agent IA

Le bloc suivant peut être placé au début de chaque nouvelle session de développement IA.

```text
Tu interviens comme architecte logiciel senior, lead developer full-stack, ingénieur sécurité applicative et product designer sur le repository SALON PRO :
https://github.com/ErwinssKoffi/barbershop

OBJECTIF PRODUIT
Faire évoluer l'ERP SALON PRO existant vers un écosystème SaaS réunissant :
1. un ERP privé de gestion des salons ;
2. un portail public de découverte des salons ;
3. une fiche publique personnalisable pour chaque salon ;
4. une galerie de photos gérée depuis l'ERP ;
5. un système de réservation publique ;
6. un agenda privé pour les gérants et réceptionnistes ;
7. des abonnements et droits d'accès SaaS ;
8. des options de visibilité sponsorisée ;
9. des statistiques marketing et, dans une phase ultérieure, des avis vérifiés et notifications avancées.

RÈGLES NON NÉGOCIABLES
- Commence par lire AGENTS.md, README.md, IMPLEMENTATION_PROGRESS.md, docs/ANALYSE_ECARTS_CAHIER_DES_CHARGES.md, docs/BASELINE_REFONTE.md, docs/CHECKOUT_SERVEUR.md, les migrations et les tests pertinents.
- Vérifie l'état courant de Git, la branche, le diff, les fichiers non suivis et la baseline. Ne détruis jamais un travail utilisateur.
- Ne suppose jamais qu'une fonction existe parce qu'elle est mentionnée dans une documentation. Inspecte son implémentation et ses tests.
- Conserve l'ERP existant et son architecture React/TypeScript/Vite, Node API, Dexie/IndexedDB et PostgreSQL/Supabase privé, sauf ADR argumenté.
- Le navigateur ne se connecte jamais directement aux tables métier privées avec une clé privilégiée.
- Chaque opération privée vérifie la session active, le membership, le rôle et le tenant côté serveur.
- Les données publiques sont servies par des projections explicitement autorisées. Ne renvoie jamais un objet métier complet ou une sauvegarde du tenant à un visiteur public.
- Les réservations sont persistées et validées côté serveur. La vérification de disponibilité dans le navigateur n'est qu'indicative.
- Les écritures concurrentes de réservation doivent être protégées par transaction et verrou approprié.
- Toute route publique doit avoir validation stricte, limites de débit, protection anti-abus, journalisation adaptée et politique de confidentialité.
- Les images ne sont pas stockées en Base64 dans PostgreSQL, Dexie ou le flux de synchronisation métier. Utilise un stockage objet et des métadonnées en base.
- Les montants XOF/FCFA sont des entiers sûrs. Ne calcule jamais un montant financier avec des flottants.
- N'invente aucun prestataire de paiement, prix d'abonnement, disponibilité, avis ou données de démonstration réalistes présentés comme réels.
- Aucun paiement d'abonnement ne doit être simulé comme confirmé. Un mode pilote manuel est acceptable s'il est audité.
- Les rendez-vous ne sont pas des ventes. Un ticket n'est créé qu'après une prestation réalisée et une action métier explicite.
- Ne lance aucune migration distante sans preuve documentée de sauvegarde ET de restauration sur une base isolée, autorisation explicite et procédure de retour arrière.
- N'active aucun flag pilote, aucune migration optionnelle et aucun mode financier de production sans critères Go/No-Go validés.

MÉTHODE
Travaille uniquement sur la phase demandée. Commence par un audit ciblé, propose l'architecture et les fichiers concernés, identifie les risques, puis implémente. Ajoute les tests avant de déclarer le travail terminé. Après chaque lot, exécute les commandes réellement présentes dans package.json et les contrôles DB pertinents. Rapporte exactement les tests exécutés, leurs résultats, les limites non validées et les migrations non appliquées.

DESIGN
Créer une expérience premium, moderne et sobre : qualité visuelle de produit SaaS, typographie nette, hiérarchie éditoriale forte, belles photographies de salons, cartes cohérentes, responsive mobile-first, animations utiles et accessibles. Réutilise le système de design déjà présent dans le repository. Ne multiplie pas les bibliothèques UI sans nécessité. Respecte prefers-reduced-motion, le contraste, le clavier et les états de chargement/erreur/vide.

LIVRABLE DE CHAQUE PHASE
- Résumé de l'objectif et du périmètre livré ;
- architecture et décisions prises ;
- liste des fichiers créés/modifiés ;
- migrations et contrats API ;
- tests ajoutés et commandes exécutées ;
- risques ou éléments non réalisés ;
- procédure de validation manuelle ;
- décision explicite : PASS, PARTIAL ou BLOCKED.
Ne prétends jamais qu'un déploiement, un webhook, une migration distante, une sauvegarde restaurée ou une intégration externe fonctionne sans preuve observable.
```

---

# 2. Vision produit et positionnement

## 2.1 Vision

SALON PRO devient une **plateforme SaaS de gestion, de visibilité et de réservation pour les professionnels de la coiffure et de la beauté**.

La solution ne se limite plus à aider un salon à gérer sa caisse, ses dépenses, son stock et son personnel. Elle lui donne également une présence numérique publique lui permettant de présenter son établissement, ses prestations, ses réalisations et de recevoir des demandes de rendez-vous.

Le portail public sert simultanément :

- de site vitrine commercial de SALON PRO ;
- d'annuaire de salons et d'instituts ;
- de canal de promotion pour les établissements abonnés ;
- de point d'entrée pour les réservations ;
- de canal d'acquisition et de référencement local.

## 2.2 Double marché

### B2B — Professionnels

Le propriétaire ou gérant souscrit à SALON PRO pour gérer son établissement et, selon son offre, publier sa fiche, promouvoir ses photos et recevoir des réservations.

### B2C — Clients finaux

Un visiteur consulte les salons, compare leurs prestations, découvre leurs photos, vérifie leurs horaires et envoie une réservation sans devoir créer obligatoirement un compte.

## 2.3 Proposition de valeur

**SALON PRO : Gérez votre salon. Développez votre visibilité. Attirez de nouveaux clients.**

La promesse doit rester honnête : SALON PRO fournit des outils de visibilité et de réservation, mais ne garantit pas un volume précis de clients ou de chiffre d'affaires.

## 2.4 Segments métier

Le produit doit rester configurable pour :

- barbershops ;
- salons de coiffure ;
- instituts de beauté ;
- salons mixtes et établissements multi-prestations.

Ne pas créer une application différente par segment. Réutiliser les objets génériques existants : prestation, variante, employé, produit, tenant, ticket, paiement.

## 2.5 Zone de lancement

Le lancement commercial peut commencer à Abidjan, avec une couverture progressive des communes et quartiers : Cocody, Marcory, Yopougon, Plateau, Treichville et autres zones réellement renseignées par les salons.

Les filtres de localisation doivent être alimentés par des données contrôlées et normalisées. Ne pas coder en dur une liste fermée de quartiers si elle doit évoluer.

---

# 3. Audit du repository et état de référence

> Cette section est un état de référence tiré de l'inspection du repository et de sa documentation au 1er novembre 2026. L'agent doit le revérifier avant toute implémentation : le code peut avoir évolué.

## 3.1 Architecture existante à préserver

Le dépôt documente notamment :

- React 19, TypeScript, Vite 8 et React Router ;
- Framer Motion pour les animations ;
- Recharts pour certains graphiques ;
- Lucide React pour les icônes ;
- Dexie / IndexedDB pour les espaces métier locaux ;
- API Node dans `server/apiHandler.ts`, avec plugin Vite local et adaptateur Vercel ;
- PostgreSQL privé, cible Supabase, dans le schéma `salon_pro` ;
- isolation multi-tenant avec `tenant_id`, FORCE ROW LEVEL SECURITY et rôle runtime restreint ;
- authentification applicative PBKDF2/HMAC, sessions révocables et refresh cookie HttpOnly rotatif ;
- synchronisation par révisions serveur et curseur ;
- PWA avec précache du shell, sans cache des API métier ou données financières.

L'authentification actuelle n'est pas Supabase Auth. Les noms historiques `neonClient` et `syncWithNeonDatabase` ne signifient pas qu'une deuxième base Neon existe.

## 3.2 Modules métier déjà structurés

Le dépôt comprend déjà des modules pour :

- tableau de bord ;
- caisse et encaissement ;
- recettes ;
- dépenses et charges récurrentes ;
- catalogue des prestations et variantes ;
- employés et paie interne ;
- stock et inventaire ;
- rapports et budget ;
- paramètres et comptes Gérant/Caissier.

Ces modules ne doivent pas être réimplémentés pour la marketplace.

## 3.3 Fondations réutilisables

- `src/domain/models/index.ts` comprend notamment `SalonInfo`, `ServiceCatalogItem`, `Employee`, `RevenueEntry` et les autres modèles métier.
- `SalonInfo` contient l'identité opérationnelle de base du salon.
- `ServiceCatalogItem` contient nom, description, prix de référence, durée, variantes et consommables.
- `src/app/router.tsx` contient actuellement les routes de l'ERP et protège la zone principale avec les composants d'authentification.
- `server/apiHandler.ts` centralise les endpoints API.
- `server/tenancySchema.ts` et les migrations définissent les mécanismes d'isolation des tenants.

Ces fondations peuvent être réutilisées, mais les données publiques doivent être exposées à travers des projections et contrats dédiés.

## 3.4 Écarts fonctionnels constatés

À la date de référence, les éléments suivants sont à construire ou à vérifier en profondeur :

| Domaine | État de référence | Travail à réaliser |
|---|---|---|
| Landing page publique | Pas de portail public dédié identifié | Créer l'expérience vitrine et marketplace |
| Annuaire des salons | Non identifié | Recherche, filtres, pagination et fiches indexables |
| Profil public du salon | Non identifié | Profil contrôlé, slug, publication et SEO |
| Galerie médias | Non identifiée | Upload objet, métadonnées, six images de galerie maximum |
| Prestations publiques | Non identifiées | Choix des services publiés à partir du catalogue ERP |
| Agenda / rendez-vous | Capacité future, non présente comme module complet | Agenda, disponibilité, conflits et réservations |
| CRM client complet | À construire | Fiche client légère, consentement et historique si nécessaire |
| Onboarding SaaS | Incomplet selon la documentation | Création organisation, tenant, propriétaire et onboarding |
| Plans / abonnements SaaS | À construire | Control plane, entitlements, facturation et audit |
| Publicité sponsorisée | Non identifiée | Campagnes, boost, règles de classement et transparence |
| Avis vérifiés | Non identifiés | Avis après rendez-vous terminé et modération |
| Analytics marketing | Non identifiées | Visites, clics et conversions agrégés |

## 3.5 Portes de sécurité et de production déjà documentées

La documentation du dépôt signale notamment :

- certaines migrations financières optionnelles 006/007 non appliquées à distance à la date de référence ;
- le pilote de checkout serveur désactivé par défaut ;
- une connexion PostgreSQL d'exécution non configurée dans l'environnement d'aperçu décrit ;
- une preuve de sauvegarde/restauration PostgreSQL hébergée non établie ;
- une recette réelle HTTPS, multi-postes et concurrence à réaliser ;
- l'absence de déploiement Cloud effectif attesté dans l'état documenté ;
- une posture No-Go production maintenue dans le suivi de référence.

Les nombres de tests rapportés dans les documents peuvent diverger selon le point de validation. L'agent doit relancer la suite complète et communiquer les résultats réellement obtenus.

## 3.6 Commandes de baseline

Node documenté : 22.18+ (baseline de référence effectuée en Node 22.22.3).

```bash
npm ci
npm run db:schema:check
npm run lint
npm test
npm run build
git diff --check
```

Selon les scripts et l'environnement disponibles, exécuter aussi :

```bash
npm run db:check
npm run dev
```

`npm run db:check` doit rester une vérification en lecture seule. Si les variables privées ou l'accès réseau PostgreSQL manquent, consigner le blocage sans inventer de configuration.

---

# 4. Périmètre fonctionnel cible

## 4.1 Les deux expériences de la plateforme

### Application privée — SALON PRO Management

Réservée aux utilisateurs authentifiés d'un tenant : Gérant, Caissier/Réception et, éventuellement dans une phase ultérieure, autres rôles métiers.

Fonctions ERP existantes conservées, auxquelles s'ajoutent :

- visibilité en ligne ;
- profil public ;
- galerie ;
- prestations publiées ;
- agenda et réservations ;
- statistiques de visibilité ;
- gestion de l'abonnement et des options si le rôle l'autorise.

### Portail public — SALON PRO Découverte

Accessible sans authentification pour les contenus publiés :

- page d'accueil SALON PRO ;
- catalogue / annuaire des salons ;
- pages de catégories ;
- pages de localisation ;
- fiche détaillée d'un salon ;
- catalogue public des prestations ;
- disponibilité de réservation ;
- parcours de réservation ;
- pages d'information et de tarifs du SaaS.

## 4.2 Landing page commerciale

La page d'accueil publique doit servir deux objectifs sans les mélanger :

1. permettre au particulier de trouver et réserver un salon ;
2. convaincre un professionnel d'adopter SALON PRO.

Sections recommandées :

1. Header : logo, navigation, lien « Trouver un salon », lien « Espace professionnel », connexion.
2. Hero : promesse claire et champ de recherche immédiatement visible.
3. Catégories : barbershop, coiffure, institut de beauté.
4. Salons à découvrir : cartes alimentées par l'API publique.
5. Salons mis en avant : campagnes sponsorisées explicitement identifiées.
6. Recherche par commune/quartier.
7. Présentation des bénéfices de la réservation en ligne.
8. Présentation de l'ERP : caisse, stock, personnel, dépenses, rapports.
9. Parcours professionnel : inscription, paramétrage, publication, réservation.
10. Plans SaaS et options, uniquement lorsque les prix et droits sont validés.
11. FAQ, preuves et témoignages vérifiés uniquement.
12. CTA final pour les particuliers et les professionnels.
13. Footer : contact, mentions légales, confidentialité, conditions et réseaux sociaux.

**Règle UX :** le visiteur qui vient chercher un barbier ne doit pas être obligé de lire la présentation complète de l'ERP avant d'accéder à la recherche.

## 4.3 Annuaire dynamique `/salons`

Fonctionnalités :

- liste des salons dont le profil est publié et éligible ;
- pagination serveur ;
- recherche par nom ;
- filtres par catégorie, ville, commune et quartier ;
- filtres par type de prestation ;
- filtre de budget si les tarifs publics sont suffisamment renseignés ;
- filtre de disponibilité uniquement si le calcul d'agenda est opérationnel ;
- tri par pertinence, proximité si la géolocalisation est disponible et autorisée, nouveautés et campagnes sponsorisées ;
- états loading, empty, error et pagination ;
- URL partageable conservant les filtres.

Le classement organique ne doit pas être manipulable par une valeur publique envoyée par le client. Les boosts sponsorisés sont ajoutés selon des règles serveur et doivent être étiquetés « Sponsorisé » ou « Mis en avant ».

## 4.4 Carte / aperçu d'un salon

Chaque carte affiche uniquement les données publiques :

- image de couverture ;
- logo si disponible ;
- nom commercial ;
- type d'établissement ;
- localisation publique ;
- courte description ;
- gamme de prix ou mention « tarifs disponibles sur la fiche » ;
- catégorie(s) de prestations ;
- badge vérifié uniquement si un processus de vérification existe ;
- mention sponsorisée si applicable ;
- CTA « Découvrir » et éventuellement « Réserver ».

Ne jamais présenter une note, un nombre d'avis, une disponibilité ou un label de vérification non vérifié en base.

## 4.5 Fiche publique individuelle `/salons/:slug`

La fiche doit fonctionner comme une mini-page professionnelle du salon.

### Identité

- nom public ;
- logo ;
- slogan facultatif ;
- description ;
- catégorie de l'établissement ;
- ville, commune, quartier et adresse publique ;
- téléphone professionnel, WhatsApp et site web si publiés ;
- horaires ;
- liens sociaux autorisés ;
- carte / itinéraire si coordonnées validées.

### Galerie

- une image de couverture ;
- jusqu'à six images supplémentaires dans la galerie au niveau de l'offre de base définie par le produit ;
- titre et légende facultatifs pour chaque image ;
- ordre personnalisable ;
- aperçu avant publication ;
- suppression et remplacement ;
- formats autorisés et limites de taille configurées côté serveur ;
- variantes miniatures et affichage responsive.

La limite de six images est une limite de produit par défaut, pas une limite de stockage arbitraire dans le code. La rendre configurable par plan via un entitlement, avec valeur par défaut de six.

### Prestations

- afficher uniquement les prestations activement publiées ;
- sélectionner une variante si le service en possède ;
- afficher la durée uniquement si elle est configurée ;
- afficher le tarif de référence ou la variante publique ;
- signaler clairement les tarifs « à partir de » si les variantes créent une fourchette ;
- proposer la réservation seulement si le service est réservable et le module autorisé.

### CTA et coordonnées

- « Réserver un rendez-vous » ;
- « Appeler » ;
- « WhatsApp » si ce canal est configuré ;
- « Itinéraire » si l'adresse/coordonnée est vérifiée ;
- « Partager ce salon » avec URL canonique et métadonnées Open Graph.

## 4.6 Espace ERP — « Visibilité en ligne »

Ajouter un module clairement séparé des réglages financiers et de la caisse.

Sous-sections recommandées :

1. Vue d'ensemble de la visibilité.
2. Profil public.
3. Galerie et médias.
4. Prestations visibles.
5. Horaires et paramètres de réservation.
6. Aperçu public.
7. Réservations reçues.
8. Statistiques.
9. Abonnement et options si autorisé.

Chaque action de publication doit fournir un retour explicite. Prévoir les états brouillon, prêt à publier, publié, suspendu et non éligible.

## 4.7 Galerie et synchronisation

Le gérant téléverse les images depuis l'ERP. Le navigateur envoie le fichier vers le stockage média par un mécanisme d'upload sécurisé. PostgreSQL conserve uniquement les métadonnées et la clé d'objet.

La publication suit ce cycle :

`Brouillon local UI → upload objet → validation serveur → métadonnées persistées → publication du profil → lecture par l'API publique`.

Ne pas ajouter les fichiers binaires à la synchronisation Dexie des sauvegardes financières. L'ERP doit pouvoir réafficher les métadonnées après synchronisation, sans répliquer les gros fichiers dans les payloads de sync.

---

# 5. Parcours de réservation et agenda

## 5.1 Objectif

Le moteur de réservation doit relier la découverte publique au planning réel du salon. Il ne doit pas être un formulaire qui enregistre une date sans vérifier les ressources disponibles.

La réservation est un module métier optionnel : la caisse doit continuer à fonctionner si l'agenda est désactivé.

## 5.2 Parcours client public

1. Le visiteur ouvre la fiche d'un salon.
2. Il consulte les prestations réservables.
3. Il choisit une prestation ou un ensemble de prestations si le salon autorise les réservations multi-prestations.
4. Il choisit un collaborateur ou « Peu importe » si l'affectation automatique est activée.
5. Il choisit une date.
6. Le système présente les créneaux calculés par le serveur.
7. Le visiteur saisit nom, téléphone, et éventuellement email/note.
8. Il accepte la politique de confidentialité et les conditions nécessaires.
9. Il soumet la réservation avec une clé d'idempotence.
10. Le serveur revérifie les règles et la disponibilité dans une transaction.
11. La réservation est créée en `pending` ou `confirmed` selon le paramétrage explicite du salon.
12. Une référence non devinable est générée et affichée.
13. Le client reçoit un accusé de réception selon les canaux disponibles.
14. Le salon reçoit une notification et voit le rendez-vous dans son agenda.

La création d'un compte client n'est pas obligatoire dans le MVP. La protection du suivi/annulation doit reposer sur une référence aléatoire et, si nécessaire, une vérification du téléphone ou un jeton dédié. Ne jamais exposer des renseignements personnels par simple incrément d'identifiant.

## 5.3 Statuts de rendez-vous

Statuts cibles :

- `pending` : demande reçue, à traiter ;
- `confirmed` : rendez-vous confirmé ;
- `rejected` : demande refusée ;
- `cancelled_by_client` : annulé par le client ;
- `cancelled_by_salon` : annulé par le salon ;
- `rescheduled` : reprogrammé, avec traçabilité de l'ancien et du nouveau créneau ;
- `completed` : prestation terminée ;
- `no_show` : client absent.

Les transitions doivent être explicites et contrôlées côté serveur. `completed` ne doit pas être déduit automatiquement du passage de l'heure.

## 5.4 Agenda privé

Vues :

- journée ;
- semaine ;
- mois ;
- liste / prochaines réservations.

Fonctionnalités :

- création manuelle d'un rendez-vous par le salon ;
- demandes issues du portail ;
- confirmation/refus ;
- reprogrammation ;
- annulation avec motif si nécessaire ;
- affectation d'un employé ;
- gestion des horaires individuels ou collectifs ;
- pauses et indisponibilités ;
- jours fermés et exceptions ;
- temps de préparation/nettoyage si paramétré ;
- historique des changements ;
- recherche par référence, client ou collaborateur selon les autorisations.

Les rôles actuels Gérant/Caissier doivent être vérifiés. Le Gérant possède la configuration et les actions d'administration de l'agenda. Le Caissier/Réception ne voit que les données et actions nécessaires au traitement des rendez-vous, sans données de paie ou informations privées non nécessaires.

## 5.5 Disponibilités : règle serveur

Le client ne doit jamais être source d'autorité pour la disponibilité.

Le serveur calcule un créneau à partir de :

- fuseau horaire du salon (`Africa/Abidjan` par défaut dans le contexte local, configurable par tenant) ;
- heures d'ouverture et exceptions ;
- durée totale des prestations ;
- durée de pause entre rendez-vous, si configurée ;
- temps de préparation ;
- disponibilité et compétence éventuelle de l'employé ;
- absences, congés ou plages bloquées ;
- rendez-vous actifs et non annulés ;
- délai minimum de réservation ;
- horizon maximum de réservation ;
- durée de réservation temporaire si un mécanisme de hold est activé.

Les dates persistées doivent être normalisées en `timestamptz` et les règles d'affichage utiliser le fuseau du salon. Ne pas mélanger heure locale et UTC dans les comparaisons.

## 5.6 Protection contre les doubles réservations

Une réponse de disponibilité peut devenir obsolète entre l'affichage et le clic de confirmation.

Le endpoint de création doit :

1. valider tenant, profil publié, droit de réservation et service ;
2. recalculer la durée ;
3. déterminer la ressource (employé ou ressource salon) ;
4. ouvrir une transaction ;
5. acquérir un verrou transactionnel adapté à la ressource et au créneau ;
6. rechercher les chevauchements avec les rendez-vous actifs ;
7. refuser proprement en cas de conflit ;
8. créer la réservation et son premier événement dans la même transaction ;
9. écrire l'événement de notification dans l'outbox dans la même transaction ;
10. retourner la confirmation canonique.

Évaluer un verrou PostgreSQL par advisory lock, contrainte d'exclusion temporelle ou autre mécanisme prouvé. La solution doit couvrir aussi les rendez-vous sans employé assigné. Une simple vérification `SELECT` suivie d'un `INSERT` sans verrou n'est pas suffisante.

## 5.7 Conversion rendez-vous → vente

Un rendez-vous n'est pas une recette et ne doit pas augmenter le chiffre d'affaires.

Le parcours après réalisation est :

`Rendez-vous confirmé → prestation réalisée → marquer terminé → préparation du ticket → encaissement → ticket canonique`.

L'interface doit permettre une conversion contrôlée et idempotente, en réutilisant le moteur d'encaissement serveur existant lorsqu'il est validé et disponible. Ne pas contourner `checkout/quote`, `checkout/commit`, la file et les règles de confirmation déjà présentes. Ne pas supposer que l'intégration booking-checkout existe.

Le modèle doit conserver la relation entre appointment et ticket sans dupliquer artificiellement les écritures financières.

---

# 6. Modèle de données cible

> Les noms ci-dessous sont des propositions de conception. L'agent doit les comparer au schéma réellement présent et produire une ADR avant les migrations.

## 6.1 Principes

- Toutes les tables métier d'un salon incluent `tenant_id` et les règles RLS correspondantes.
- Toute clé étrangère inter-table métier doit inclure le tenant si nécessaire pour empêcher les références croisées.
- Les index doivent commencer par `tenant_id` pour les accès tenant-scoped lorsque cela est pertinent.
- Les statuts utilisent des CHECK constraints ou types contrôlés.
- Les timestamps sont en `timestamptz` ; les montants en entiers XOF.
- Les données publiques sont séparées des données opérationnelles privées.
- Les suppressions de contenus doivent respecter les historiques, références et obligations de conservation.

## 6.2 `salon_public_profiles`

Rôle : configuration de la vitrine publique associée à un tenant.

Champs indicatifs :

- `id UUID PRIMARY KEY` ;
- `tenant_id UUID NOT NULL UNIQUE` ;
- `slug TEXT NOT NULL UNIQUE` ;
- `publication_status` : `draft`, `published`, `hidden`, `suspended` ;
- `display_name TEXT` ;
- `tagline TEXT` ;
- `description TEXT` ;
- `business_category TEXT` ;
- `city`, `commune`, `neighborhood`, `public_address` ;
- `public_phone`, `public_whatsapp`, `public_email`, `website_url` ;
- `latitude`, `longitude` si vérifiées et facultatives ;
- `logo_media_id`, `cover_media_id` ;
- `booking_enabled BOOLEAN` ;
- `published_at`, `created_at`, `updated_at`.

Le slug est unique, normalisé, non vide et modifiable selon une politique qui préserve les anciennes URL (alias/redirect si le produit le permet). Le slug public est indépendant du UUID/slug interne du tenant.

## 6.3 `salon_media`

Rôle : métadonnées des images et médias publics.

Champs indicatifs :

- `id UUID` ;
- `tenant_id UUID` ;
- `storage_provider` ;
- `object_key` ;
- `media_kind` : `logo`, `cover`, `gallery` ;
- `title`, `caption`, `alt_text` ;
- `position` ;
- `mime_type`, `byte_size`, `width`, `height` ;
- `status` : `pending`, `ready`, `rejected`, `deleted` ;
- `created_by`, `created_at`, `updated_at`.

Ne pas conserver de clé secrète de stockage dans la base. L'URL publique, lorsqu'elle existe, doit être délivrée par le fournisseur ou construite par un composant serveur à partir d'une configuration autorisée.

## 6.4 `salon_public_services`

Rôle : contrôler les prestations que le salon rend visibles et réservables.

Champs indicatifs :

- `tenant_id` ;
- `service_id` ;
- `is_public` ;
- `is_bookable` ;
- `public_title` et `public_description` facultatifs ;
- `position` ;
- `created_at`, `updated_at`.

Créer une relation composite vers le service du même tenant. Les prix et durées sont lus depuis la source métier autorisée, ou exposés sous forme de snapshot public maîtrisé si une politique historique est nécessaire. Éviter les doubles sources de vérité tarifaire.

## 6.5 Horaires et indisponibilités

Tables recommandées :

- `salon_opening_hours` : horaires réguliers par jour de semaine ;
- `employee_working_hours` ou configuration générique de ressources ;
- `schedule_exceptions` : fermetures, jours exceptionnels et horaires modifiés ;
- `schedule_blocks` : pause, congé, absence, maintenance et autres plages non réservables.

Autoriser plusieurs plages d'ouverture par jour (matin et après-midi, par exemple). Valider les bornes et les chevauchements.

## 6.6 `appointments`

Champs indicatifs :

- `id UUID` ;
- `tenant_id UUID` ;
- `public_reference` générée aléatoirement ;
- `source` : `public_web`, `salon_manual`, `other` ;
- `status` ;
- `client_name` ;
- `client_phone` normalisé ;
- `client_email` facultatif ;
- `client_note` facultatif et filtré ;
- `employee_id` nullable selon les règles d'affectation ;
- `resource_key` ou référence de ressource permettant le verrouillage ;
- `start_at`, `end_at` en `timestamptz` ;
- `timezone` du salon ;
- `duration_minutes` ;
- `price_estimate_xof` facultatif, non assimilé à une recette ;
- `idempotency_key` ;
- `created_at`, `updated_at`, `confirmed_at`, `cancelled_at`, `completed_at`.

Ne pas exposer l'identifiant interne ni les coordonnées privées à travers l'API publique.

## 6.7 `appointment_services`

Conserver le détail des prestations sélectionnées : service ID, variante ID, libellé snapshot, quantité, durée snapshot et prix estimé snapshot. Les snapshots protègent la compréhension historique du rendez-vous si le catalogue évolue après la demande.

## 6.8 `appointment_events`

Journal immuable des transitions :

- appointment ID + tenant ;
- action et statut avant/après ;
- auteur (utilisateur, client/public, système) ;
- motif facultatif ;
- date ;
- métadonnées minimales.

Ne pas permettre au client de réécrire directement l'historique.

## 6.9 Abonnements et entitlements

Tables possibles :

- `saas_plans` ;
- `saas_plan_entitlements` ;
- `tenant_subscriptions` ;
- `subscription_events` ;
- `billing_records` ou `subscription_invoices` ;
- `payment_provider_events` lorsque l'intégration réelle sera décidée.

Le control plane SaaS doit être séparé des opérations métier et des recettes du salon.

Entitlements configurables :

- `public_profile_enabled` ;
- `gallery_image_limit` ;
- `public_services_enabled` ;
- `online_booking_enabled` ;
- `booking_horizon_days` ;
- `marketing_analytics_enabled` ;
- `featured_campaigns_enabled` ;
- `employee_booking_enabled` ;
- autres limites métier approuvées.

Ne pas disperser des vérifications de plan en dur dans les composants React. Centraliser les droits côté serveur et exposer une projection des fonctionnalités à l'interface.

## 6.10 Promotion et campagnes

Table possible `visibility_campaigns` ou `salon_promotions` :

- tenant ;
- type de placement ;
- début et fin ;
- statut ;
- budget ou prix convenu en XOF ;
- référence de paiement ou statut manuel audité ;
- emplacements autorisés ;
- impressions/clics agrégés ;
- created_by et audit.

Aucun placement payant ne doit être présenté comme une recommandation organique.

## 6.11 Analytique et avis

`public_analytics_events` ou pipeline agrégé : vues de fiche, clics réservation, clics téléphone/WhatsApp et conversions. Minimiser les données personnelles, définir rétention et consentement/cookie selon les choix juridiques du produit.

`salon_reviews` : uniquement lorsqu'un lien vérifiable existe avec un rendez-vous terminé. Prévoir modération, signalement, réponse du salon et protection contre les avis multiples abusifs. Ne jamais injecter de faux avis ou de notes de démonstration dans les données réelles.

## 6.12 Notifications

`notification_outbox` : événement, tenant, destinataire, canal, payload minimal, statut d'envoi, compteur de tentatives, prochaine tentative et dates.

Écrire l'outbox dans la même transaction que l'événement métier. L'envoi externe se fait ensuite avec retry borné et idempotence. Ne pas prétendre qu'un message WhatsApp ou SMS est envoyé avant confirmation du prestataire.

---

# 7. Architecture applicative et intégration

## 7.1 Décision d'architecture recommandée

Conserver l'ERP React/Vite existant et créer un portail public distinct, idéalement avec Next.js pour le rendu serveur, le référencement et les pages publiques indexables.

Architecture logique :

```text
                  VISITEUR PUBLIC
                         |
                         v
              PORTAIL SALON PRO (Next.js)
         Landing | Annuaire | Fiches | Booking
                         |
                  API HTTPS contrôlée
                         |
                         v
             BACKEND SALON PRO (Node API)
       Auth | Tenants | Catalogue | Booking | SaaS
                         |
              +----------+----------+
              |                     |
              v                     v
       PostgreSQL privé       Stockage objet média
       schéma salon_pro       images optimisées
              ^
              |
       ERP SALON PRO (Vite)
 Caisse | Stock | Personnel | Agenda | Visibilité
```

Cette séparation est une cible recommandée, pas une autorisation de restructurer le dépôt sans étude. L'agent doit proposer une ADR précisant les impacts de déploiement, CORS, sessions et cookies.

## 7.2 Organisation du code proposée

À adapter à la structure effective du repository. Exemple de cible :

```text
repository/
├── src/                         # ERP React/Vite existant
│   ├── app/
│   ├── features/
│   │   ├── visibility/
│   │   └── appointments/
│   ├── domain/
│   └── ...
├── server/                      # API Node existante
│   ├── publicDirectory/
│   ├── publicProfile/
│   ├── media/
│   ├── appointments/
│   ├── subscriptions/
│   ├── promotions/
│   └── ...
├── supabase/migrations/         # migrations privées existantes + nouvelles
├── marketplace/                 # nouvelle application Next.js autonome
│   ├── app/
│   │   ├── page.tsx
│   │   ├── salons/
│   │   ├── categories/
│   │   ├── villes/
│   │   └── professionnels/
│   ├── components/
│   ├── lib/
│   └── ...
└── docs/
    ├── product/
    ├── architecture/
    └── runbooks/
```

Ne pas créer cette structure aveuglément. Examiner les alias TypeScript, Vite, les tests, le package manager et les paramètres Vercel avant de choisir le découpage exact.

## 7.3 Déploiement et domaines

Cible possible :

- `www.salonpro.ci` : portail public ;
- `app.salonpro.ci` : ERP privé ;
- backend API sur un domaine ou une origine explicitement configurée.

Si les applications sont sur des origines différentes :

- CORS allowlist stricte ;
- cookies `Secure`, `HttpOnly`, `SameSite` cohérents avec les flux ;
- protection CSRF et vérification Origin pour les écritures ;
- aucune wildcard CORS avec credentials ;
- refresh et sessions testés réellement sur les navigateurs ciblés.

Ne pas partager les cookies par domaine parent par défaut sans analyse de sécurité. Les réservations publiques doivent utiliser un mécanisme indépendant des sessions ERP.

## 7.4 Source de vérité et read model public

PostgreSQL reste la source de vérité des données métier et des profils. Le portail public ne doit pas interroger les tables financières.

Prévoir un read model / une projection publique minimale pour les données publiées. Cette projection peut être une table dédiée, une vue ou une fonction SQL strictement contrôlée, selon l'ADR.

Exigences :

- ne sélectionner que les champs publics ;
- ne pas rendre les tables métier lisibles anonymement ;
- ne pas exposer tenant ID ou informations privées au navigateur sans nécessité ;
- garantir qu'un profil brouillon/suspendu n'est pas visible ;
- purger ou invalider les caches lorsqu'un profil est dépublié ;
- contrôler la cohérence du statut d'abonnement et des entitlements.

Le mécanisme de résolution d'un slug public à travers plusieurs tenants nécessite une conception SQL sécurisée. Ne pas désactiver RLS globalement. Évaluer un read model public dédié ou une fonction serveur à privilèges minimaux, avec `search_path` fixe, paramètres validés, sortie réduite et tests d'isolation.

## 7.5 Intégration au routeur ERP

Le routeur actuel utilise `/` pour la zone ERP protégée et redirige l'index vers le dashboard. L'ajout d'un portail public sur la même origine nécessite une stratégie explicite :

- soit un domaine/application séparé, recommandé ;
- soit une refonte contrôlée des préfixes publics et privés avec redirects compatibles.

Ne pas remplacer la route racine sans inventorier les liens profonds, routes existantes, tests et comportement PWA. Préserver l'accès aux anciennes URL pendant une période de transition.

---

# 8. API et contrats fonctionnels

Les routes ci-dessous sont des contrats cibles à discuter et à documenter. Elles ne sont pas réputées exister dans le code actuel.

## 8.1 API publique — lecture

```http
GET /api/public/salons
GET /api/public/salons/:slug
GET /api/public/salons/:slug/services
GET /api/public/salons/:slug/availability?date=YYYY-MM-DD&serviceId=...
GET /api/public/categories
GET /api/public/locations
```

Réponses : DTOs publics stricts, versionnés si nécessaire. Pagination par curseur ou mécanisme stable. Filtres validés côté serveur.

Exemple de projection de fiche :

```json
{
  "slug": "the-gentlemen-cocody",
  "name": "The Gentlemen Barber",
  "category": "barbershop",
  "description": "Description validée par le salon",
  "location": {
    "city": "Abidjan",
    "commune": "Cocody",
    "neighborhood": "Riviera"
  },
  "media": [],
  "services": [],
  "openingHours": [],
  "bookingEnabled": true
}
```

Cet exemple est un contrat de structure, pas une donnée réelle à insérer.

## 8.2 API publique — réservation

```http
POST /api/public/salons/:slug/bookings
GET  /api/public/bookings/:reference
POST /api/public/bookings/:reference/cancel
```

La consultation et l'annulation exigent un mécanisme de vérification du demandeur ou un jeton non devinable et limité. Ne pas exposer des noms, téléphones ou notes du client à travers une référence courte.

Le POST de réservation exige :

- validation stricte des champs ;
- service(s) autorisé(s) ;
- date et durée recalculées par serveur ;
- contrôle de publication et entitlement ;
- idempotency key ;
- anti-spam et rate limit ;
- transaction avec verrou anti-conflit ;
- création de l'événement initial et de l'outbox ;
- réponse canonique avec référence et statut.

## 8.3 API privée — profil public et médias

```http
GET    /api/salon/public-profile
PUT    /api/salon/public-profile
POST   /api/salon/media/upload-intent
POST   /api/salon/media/complete
DELETE /api/salon/media/:mediaId
PUT    /api/salon/media/reorder
PUT    /api/salon/public-services
POST   /api/salon/public-profile/publish
POST   /api/salon/public-profile/unpublish
```

Vérifier session, membership, rôle Gérant, tenant résolu côté serveur et entitlement. Ne jamais accepter un `tenantId` fourni par le client comme preuve d'autorisation.

Pour l'upload : utiliser des URL signées à durée limitée ou un upload relayé selon le fournisseur retenu. Vérifier le MIME réel, la taille, la dimension, l'extension, l'identité et le quota. Prévoir nettoyage des uploads incomplets.

## 8.4 API privée — agenda et rendez-vous

```http
GET    /api/appointments
POST   /api/appointments
GET    /api/appointments/:id
PATCH  /api/appointments/:id/status
POST   /api/appointments/:id/reschedule
GET    /api/appointments/availability
GET    /api/appointments/settings
PUT    /api/appointments/settings
```

Les actions doivent produire un événement d'audit. Les permissions varient selon Gérant et Caissier/Réception.

## 8.5 API control plane SaaS

Exemples de contrats à définir après audit de l'onboarding existant :

```http
GET  /api/saas/plans
GET  /api/saas/subscription
POST /api/saas/onboarding
POST /api/saas/subscription/checkout-intent
POST /api/saas/subscription/cancel
```

Les endpoints de l'administrateur plateforme doivent être séparés des routes métier du salon et protégés par un rôle de contrôle SaaS dédié.

## 8.6 API marketing

```http
GET  /api/salon/visibility/analytics
POST /api/salon/visibility/campaigns
GET  /api/salon/visibility/campaigns
POST /api/salon/visibility/campaigns/:id/cancel
```

La création d'une campagne doit contrôler l'entitlement, la période, le paiement ou l'approbation manuelle, les emplacements autorisés et les règles de classement.

---

# 9. Abonnements, droits et monétisation

## 9.1 Modèle commercial cible

La structure commerciale comporte trois niveaux de valeur, à finaliser avec une étude des coûts et du marché :

1. **SALON PRO Gestion** : ERP de gestion.
2. **SALON PRO Visibilité** : ERP + fiche publique + galerie + prestations publiques + réservation selon la formule.
3. **SALON PRO Boost** : campagne de visibilité ponctuelle, en option.

Ne pas fixer de tarifs dans le code avant décision produit. Les plans doivent être pilotés par les données et entitlements.

## 9.2 Abonnement récurrent vs promotion ponctuelle

Distinguer :

- abonnement : donne accès aux fonctionnalités récurrentes prévues dans le forfait ;
- boost : option limitée dans le temps et dans des emplacements précis.

Un abonné ne doit pas payer deux fois pour une fonction déjà comprise dans son forfait.

## 9.3 États de souscription

États à étudier :

- `trialing` ;
- `active` ;
- `past_due` ;
- `grace_period` ;
- `suspended` ;
- `cancelled` ;
- `expired`.

La politique de délai de grâce est une décision commerciale et doit être configurable. Les rendez-vous déjà confirmés doivent demeurer consultables et traitables même après suspension ou résiliation. Une résiliation ne doit jamais entraîner la suppression des données du tenant.

## 9.4 Pilote de paiement

Pour le pilote, l'administrateur peut activer manuellement un abonnement après vérification hors plateforme, avec journal d'audit : acteur, motif, montant, période et référence externe.

Aucun fournisseur ne doit être intégré avant comparaison documentée : disponibilité en Côte d'Ivoire, moyens de paiement, frais, délais de règlement, remboursements, webhooks signés, support, conformité et environnement sandbox.

Quand un prestataire sera retenu :

- signature des webhooks ;
- idempotence des événements ;
- protection contre rejeu ;
- rapprochement des paiements ;
- journal d'audit ;
- gestion des échecs et remboursements ;
- aucune activation sur un simple retour navigateur.

## 9.5 Règles d'entitlement

Le backend doit être la source d'autorité des droits. Exemples :

| Entitlement | Effet |
|---|---|
| `public_profile_enabled` | Autorise la publication de la fiche |
| `gallery_image_limit` | Nombre d'images de galerie maximum |
| `public_services_enabled` | Autorise le catalogue public |
| `online_booking_enabled` | Autorise la réservation publique |
| `booking_horizon_days` | Horizon maximal de réservation |
| `marketing_analytics_enabled` | Autorise les statistiques détaillées |
| `featured_campaigns_enabled` | Autorise l'achat d'une campagne boost |

Le frontend peut masquer une action non autorisée, mais le serveur doit refuser l'opération si l'entitlement n'est pas valide.

---

# 10. Acquisition, SEO et croissance

## 10.1 Référencement naturel

La marketplace doit être conçue pour être indexable :

- rendu serveur / génération statique contrôlée des pages publiques ;
- titre et description uniques par salon ;
- canonical URL ;
- sitemap dynamique des profils publiés ;
- `robots.txt` ;
- Open Graph et Twitter cards ;
- images optimisées et attributs alt ;
- URLs stables et slugs lisibles ;
- liens internes entre catégories, communes, quartiers et salons ;
- pages de localisation réellement utiles, pas des pages vides générées en masse.

Données structurées à étudier selon les faits disponibles : `LocalBusiness`, type plus précis pertinent pour l'établissement, `Service`, `Offer` et `BreadcrumbList`. Ne jamais marquer comme vérifié, ouvert ou noté ce qui ne l'est pas.

## 10.2 Partage social et WhatsApp

Chaque fiche doit disposer :

- d'une URL canonique ;
- d'une image Open Graph ;
- d'un titre et résumé partageables ;
- d'un bouton « Partager mon salon » dans l'ERP ;
- d'un QR code pointant vers la fiche ou le booking.

Le lien de partage ne doit pas inclure de token privé, de téléphone non public ou de données de rendez-vous.

## 10.3 QR codes

MVP : générer un QR code stable par profil public publié. Prévoir deux destinations configurables : fiche publique ou réservation.

Les statistiques QR ne doivent être enregistrées que si le tracking est documenté et conforme à la politique de confidentialité.

## 10.4 Statistiques marketing

Indicateurs proposés :

- vues de la fiche ;
- clics sur « Réserver » ;
- demandes de rendez-vous soumises ;
- rendez-vous confirmés ;
- clics sur téléphone et WhatsApp ;
- taux de conversion simple ;
- performances des campagnes sponsorisées.

Distinguer les événements et les conversions réelles. Une vue n'est pas un visiteur unique, un clic n'est pas une réservation, et une demande n'est pas un rendez-vous confirmé. Documenter les définitions des KPI.

## 10.5 Avis vérifiés — phase ultérieure

- éligibilité seulement après rendez-vous `completed` ;
- une règle de nombre d'avis par rendez-vous ;
- modération et signalement ;
- réponse du salon ;
- audit des changements ;
- affichage des avis réellement enregistrés ;
- protection contre les faux avis et manipulations.

## 10.6 Publicité sponsorisée

Les salons peuvent acheter un boost de 7, 15 ou 30 jours si ces durées sont retenues dans l'offre commerciale.

Les emplacements possibles :

- bloc « Salons mis en avant » sur la page d'accueil ;
- haut d'une catégorie ;
- emplacement local dans une commune ;
- campagne temporaire.

Les annonces doivent être identifiées comme sponsorisées. Les règles d'éligibilité, dates de diffusion, paiement et arrêt doivent être auditées.

---

# 11. Design system et expérience utilisateur

## 11.1 Direction artistique

SALON PRO doit projeter une image de logiciel professionnel, premium et fiable. Le portail public doit valoriser l'esthétique des établissements sans tomber dans une interface surchargée.

Références de qualité souhaitées : produits SaaS modernes, éditorial premium, commerce visuel de qualité, hiérarchie claire, cartes sobres, photographie forte, micro-interactions utiles.

## 11.2 Règles UX

- Mobile-first : le visiteur doit pouvoir réserver confortablement depuis son smartphone.
- Recherche visible dès le premier écran.
- Photos optimisées, jamais de lourdes galeries bloquant le chargement.
- CTA explicites et cohérents.
- Formulaires courts, sans création de compte obligatoire pour une réservation simple.
- États loading, error, empty, success et disabled conçus.
- Accessibilité clavier et lecteurs d'écran.
- Contrastes conformes ; ne pas communiquer un statut uniquement par couleur.
- `prefers-reduced-motion` respecté.
- Animation modérée, sans pénaliser les appareils modestes.

## 11.3 Composants UI à prévoir

- `PublicSiteHeader` ;
- `PublicSiteFooter` ;
- `SalonSearchBar` ;
- `SalonFilters` ;
- `SalonCard` ;
- `SalonGrid` ;
- `FeaturedSalonSection` ;
- `SalonHero` ;
- `SalonGallery` ;
- `ServicePublicCard` ;
- `OpeningHours` ;
- `LocationSummary` ;
- `BookingCTA` ;
- `BookingWizard` ;
- `AvailabilityCalendar` ;
- `TimeSlotPicker` ;
- `BookingConfirmation` ;
- `VisibilityProfileEditor` ;
- `MediaUploader` ;
- `MediaReorderList` ;
- `PublicProfilePreview` ;
- `AppointmentCalendar` ;
- `AppointmentStatusBadge` ;
- `SubscriptionEntitlementGate`.

Ces noms sont indicatifs. Réutiliser les composants déjà disponibles quand ils sont adaptés.

---

# 12. Sécurité, confidentialité et exploitation

## 12.1 Séparation public / privé

Le portail public ne reçoit que les données explicitement publiées. Ne pas exposer un objet `SalonBackupPayload`, `FullSalonState`, un modèle employé complet ou une ligne financière.

Le backend construit des DTOs whitelistés. Il ne suffit pas de masquer les champs dans React.

## 12.2 Multi-tenant

Chaque opération privée doit :

- vérifier la session active ;
- résoudre tenant depuis la session/membership en base ;
- vérifier le rôle ;
- appliquer RLS et le rôle runtime restreint ;
- utiliser des requêtes tenant-scoped ;
- contrôler les clés étrangères tenant ;
- empêcher les références croisées entre salons.

Les requêtes publiques cross-tenant doivent être limitées au read model public publié et à une projection minimale.

## 12.3 Gestion des médias

- validation MIME réelle et décodage du fichier ;
- limite de taille configurable ;
- dimensions et ratio autorisés ;
- antivirus/modération automatique si le risque et le fournisseur le justifient ;
- nom d'objet aléatoire, aucune utilisation directe du nom utilisateur ;
- suppression des métadonnées EXIF sensibles lorsque possible ;
- génération de variantes optimisées ;
- upload signé à durée courte ;
- validation tenant et entitlement côté serveur ;
- protection contre IDOR et remplacement d'image d'un autre tenant ;
- nettoyage des uploads incomplets et objets orphelins.

## 12.4 Réservations publiques anti-abus

Prévoir :

- rate limiting par IP, profil et empreinte raisonnable ;
- idempotence ;
- honeypot ou challenge adaptatif ;
- validation téléphone ;
- protection contre l'énumération de références ;
- politique de fréquence et d'annulation ;
- journalisation minimisée ;
- réponse neutre sur les références inconnues lorsque cela protège la confidentialité.

Ne pas introduire un CAPTCHA intrusif systématique sans mesurer le besoin.

## 12.5 Protection des données personnelles

Le système collecte au minimum des données de contact pour prendre un rendez-vous. L'agent doit produire une analyse de données personnelles et proposer :

- finalités de traitement clairement décrites ;
- champs minimaux ;
- durée de conservation ;
- suppression/anonymisation contrôlée ;
- droits d'accès et de rectification ;
- gestion des consentements lorsque nécessaire ;
- séparation notes internes / informations visibles par le client ;
- journalisation sans données excessives.

Les obligations juridiques applicables en Côte d'Ivoire doivent être vérifiées avant la mise en production. Ne pas affirmer une conformité juridique sans revue compétente.

## 12.6 Sécurité API et web

- validation des entrées côté serveur ;
- limitation de débit ;
- CORS stricte ;
- CSRF/Origin pour les routes à cookie ;
- contrôle des méthodes HTTP ;
- sécurité des headers ;
- CSP compatible avec les origines réellement nécessaires ;
- protection contre XSS, SQL injection, SSRF et open redirects ;
- logs structurés sans secrets ni PII non nécessaires ;
- secrets exclusivement côté serveur ;
- dépendances contrôlées ;
- sauvegarde/restauration et monitoring.

Le CSP existant du projet devra être adapté seulement après détermination des origines média/API. Ne pas l'assouplir globalement avec `*`.

---

# 13. Tests, critères d'acceptation et définition de terminé

## 13.1 Tests unitaires

- normalisation de slug ;
- validation des profils ;
- règles d'entitlement ;
- limites de galerie ;
- calcul de durée ;
- calcul de disponibilité ;
- transitions de statut appointment ;
- classification des événements analytics ;
- règles de classement sponsorisé.

## 13.2 Tests API / intégration SQL

- lecture publique d'un profil publié ;
- absence d'accès à un profil brouillon/suspendu ;
- tenant A impossible à lire ou modifier depuis le tenant B ;
- projection publique sans salaire, recettes, coordonnées privées ou détails de compte ;
- publication refusée si entitlement absent ;
- limite de six images appliquée serveur ;
- upload d'un fichier invalide rejeté ;
- rendez-vous créé avec statut attendu ;
- conflit concurrent : un seul rendez-vous peut prendre la ressource ;
- idempotence : même clé et même contenu ne créent pas deux rendez-vous ;
- même clé avec contenu différent rejetée ;
- transition de statut non autorisée rejetée ;
- résiliation sans suppression des rendez-vous historiques ;
- webhook fictif ou signature incorrecte rejetée lorsqu'un prestataire sera intégré.

## 13.3 Tests UI

- navigation publique ;
- recherche/filtres et pagination ;
- galerie responsive ;
- prévisualisation avant publication ;
- upload et réordonnancement ;
- réservation complète mobile ;
- affichage d'un conflit de créneau ;
- vue agenda jour/semaine ;
- permission Gérant/Caissier ;
- absence de données sensibles dans le DOM et les appels réseau.

## 13.4 Tests E2E réels

Avant lancement :

- deux navigateurs et deux visiteurs réservent le même créneau simultanément ;
- client annule avec les bonnes preuves ;
- gérant reprogramme ;
- réservation terminée puis convertie en vente ;
- compte d'un autre tenant tente d'accéder au rendez-vous ;
- profil dépublié disparaît de l'annuaire et du sitemap ;
- image supprimée n'est plus accessible selon politique de cache ;
- plan suspendu bloque les nouvelles réservations selon les règles définies.

## 13.5 Accessibilité et performance

- navigation clavier ;
- focus visible ;
- labels/form errors ;
- contraste ;
- reduced motion ;
- images `sizes`, lazy loading et formats optimisés ;
- Core Web Vitals mesurés sur un déploiement réel ;
- pagination serveur et index DB ;
- test de charge des créneaux et annuaires.

## 13.6 Définition de terminé — DoD

Une phase est terminée uniquement si :

- le besoin et les critères d'acceptation sont satisfaits ;
- les tests nouveaux et existants passent ;
- lint, build et vérification de schéma passent ;
- aucun secret n'a été ajouté au code ;
- les autorisations sont testées au niveau serveur ;
- les migrations sont additives et leur statut est clair ;
- les documents sont mis à jour ;
- les limites et validations non effectuées sont explicitement signalées.

---

# 14. Déploiement, migration et portes Go / No-Go

## 14.1 Avant tout DDL distant

Obligatoire :

1. identifier la base et l'environnement ciblés ;
2. confirmer la sauvegarde via le moyen autorisé ;
3. vérifier le résultat complet de la sauvegarde ;
4. restaurer dans un environnement isolé ;
5. comparer comptes, tenants, memberships, schémas, tickets, journaux et curseurs ;
6. documenter la preuve de restauration ;
7. répéter la migration sur une copie ;
8. prévoir rollback applicatif et procédure de restauration ;
9. obtenir autorisation explicite de migration distante.

Une exportation non restaurée n'est pas une preuve de sauvegarde exploitable.

## 14.2 Déploiement coordonné

Si le schéma, l'API et les applications changent ensemble :

- migrations compatibles ;
- API déployée avec compatibilité descendante si nécessaire ;
- ERP et marketplace versionnés ;
- flags désactivés par défaut ;
- pilote sur un nombre limité de salons ;
- logs et métriques ;
- procédure d'arrêt du booking public sans arrêter la caisse.

## 14.3 Kill switches

Prévoir des flags serveur distincts :

- `PUBLIC_MARKETPLACE_ENABLED` ;
- `PUBLIC_PROFILE_PUBLISH_ENABLED` ;
- `PUBLIC_BOOKING_ENABLED` ;
- `PUBLIC_MEDIA_UPLOAD_ENABLED` ;
- `PROMOTIONS_ENABLED` ;
- `SUBSCRIPTION_BILLING_ENABLED`.

Un flag global ne doit pas mettre en panne l'ERP. Chaque fonction optionnelle doit échouer de façon contrôlée.

## 14.4 No-Go production si

- isolation tenant non démontrée ;
- réservations concurrentes non protégées ;
- secrets ou données privées exposées ;
- migration distante sans restauration vérifiée ;
- abonnements simulés comme payés ;
- routes publiques non protégées contre spam ;
- paiements/webhooks non validés ;
- tests de base ou CI rouge ;
- politique de conservation des données non définie ;
- dépendance booking empêchant la caisse de fonctionner.

---

# 15. Workflow d'implémentation — phases et prompts autonomes

## Vue d'ensemble

| Phase | Nom | Livrable principal | Dépendances |
|---|---|---|---|
| 00 | Audit et baseline | Rapport d'état réel et plan précis | Aucune |
| 01 | Architecture & ADR | Décisions techniques validées | 00 |
| 02 | Modèle de données & sécurité DB | Migrations additives, RLS, tests | 01 + backup/restore avant DDL distant |
| 03 | Profil public & médias | Profil éditable, galerie et publication | 02 |
| 04 | Portail public & annuaire | Landing, recherche, fiches, SEO | 02-03 |
| 05 | Moteur de réservation | Disponibilités, création, concurrence | 02-03 |
| 06 | Agenda ERP & conversion | Gestion des rendez-vous et lien checkout | 05 |
| 07 | Control Plane & abonnements | Plans, entitlements et cycle de vie | 01-02 |
| 08 | Boost, QR, analytics, avis | Acquisition et monétisation | 04 + 07, avis après 06 |
| 09 | QA, sécurité et déploiement | Pilote contrôlé et runbooks | Phases précédentes |

Les phases 05 et 07 peuvent être préparées en parallèle après la phase 02, mais ne pas les fusionner dans une grosse modification non testable. La phase 04 peut démarrer avec une source de profils de test isolée pour la UI, mais aucun seed fictif ne doit être déployé en production.

---

## PROMPT 00 — Audit du repository, baseline et plan d'intégration

```text
Tu démarres le projet SALON PRO Marketplace & Booking.

Ne développe encore aucune fonctionnalité.

1. Lis AGENTS.md, README.md, IMPLEMENTATION_PROGRESS.md, docs/ANALYSE_ECARTS_CAHIER_DES_CHARGES.md, docs/BASELINE_REFONTE.md, docs/CHECKOUT_SERVEUR.md, SUPABASE_SETUP.md, VERCEL_SETUP.md, les migrations et les tests concernés.
2. Examine l'état Git : branche, commit, diff, fichiers non suivis, travaux non commités. Ne nettoie et ne réinitialise rien.
3. Inspecte le routeur, les modèles, le serveur API, les repositories Dexie, les migrations, les contrats d'authentification et les composants UI.
4. Confirme ce qui existe réellement pour profils publics, médias, horaires, agenda, rendez-vous, abonnements, plans et facturation. Cite les fichiers et tests.
5. Exécute la baseline disponible : db:schema:check, lint, tests, build et diff check. Pour db:check, n'effectue aucune écriture.
6. Identifie les blocages de production déjà consignés : connexion DB, sauvegarde/restauration, migrations optionnelles, Vercel, HTTPS et concurrence.
7. Construis une matrice Exigence / État réel / Preuve / Écart / Risque / Phase proposée.
8. Propose un ordre d'exécution et les fichiers probablement concernés.

Livrables :
- docs/marketplace/00_REPOSITORY_AUDIT.md
- docs/marketplace/00_BASELINE_RESULTS.md
- liste des inconnues bloquantes et des ADR à produire.

Ne modifie aucun module métier et n'ajoute aucune migration. Termine par PASS, PARTIAL ou BLOCKED.
```

**Porte de validation :** le rapport distingue les fonctions réellement codées, testées localement, validées en environnement hébergé et déployées. Aucun développement tant que les risques majeurs ne sont pas identifiés.

---

## PROMPT 01 — Architecture cible, ADR et design de l'intégration

```text
À partir du rapport d'audit validé, conçois l'architecture de SALON PRO Marketplace & Booking.

Objectifs : ERP existant conservé, portail public indexable, API commune contrôlée, PostgreSQL source de vérité, stockage objet pour médias, réservations robustes et control plane séparé.

Travail demandé :
1. Compare au moins deux options : portail Next.js séparé vs portail dans le Vite existant. Évalue SEO, déploiement, cookies, CORS, coûts, maintenance et impact sur le repository.
2. Recommande une cible et justifie-la. Si Next.js est retenu, définis comment l'introduire sans casser le package root ni les builds ERP.
3. Définis domaines : public directory, profile/media, appointments, scheduling, subscriptions/entitlements, promotions, analytics, notifications.
4. Définis les frontières public/privé et les DTOs.
5. Définis le mécanisme sécurisé de résolution des slugs cross-tenant via un read model public strictement limité.
6. Définis les flux upload média, publication, lecture publique, réservation et conversion en ticket.
7. Définis les rôles et permissions Gérant/Caissier/administrateur SaaS.
8. Définis les feature flags et stratégies de rollback.
9. Propose les ADR : ADR-001 portail ; ADR-002 read model public ; ADR-003 stockage média ; ADR-004 booking concurrency ; ADR-005 entitlements ; ADR-006 domaines/cookies.
10. Mets à jour les diagrammes Mermaid et la documentation d'architecture.

Ne modifie pas encore le schéma DB ni les routes métier. Aucune migration distante.

Livrables : docs/marketplace/01_TARGET_ARCHITECTURE.md et docs/marketplace/adr/*.md.
```

**Porte de validation :** choix de déploiement, CORS/cookies, sécurité cross-tenant et stratégie de données validés avant code.

---

## PROMPT 02 — Modèle PostgreSQL, migrations additives et RLS

```text
Implémente uniquement le socle de données Marketplace & Booking validé dans les ADR.

Avant de coder : relis les migrations en place, les conventions de schema private salon_pro, les tests RLS et les outils de migration.

Tables candidates : salon_public_profiles, salon_media, salon_public_services, salon_opening_hours, schedule_exceptions, schedule_blocks, appointments, appointment_services, appointment_events, saas_plans, saas_plan_entitlements, tenant_subscriptions, subscription_events, notification_outbox. N'ajoute que les tables nécessaires à la tranche retenue.

Exigences :
- migration nouvelle, additive et versionnée ; aucune réécriture des migrations historiques ;
- tenant_id partout où nécessaire ; PK/FK et index tenant-scoped ;
- RLS ENABLE + FORCE et runtime role restreint ;
- aucune politique qui rend les tables métier privées lisibles par anon ;
- projection publique minimale conçue selon ADR ;
- contraintes de statut, de slug et de cardinalité ;
- dates timestamptz ; montants en entiers XOF ;
- audit et événements immuables lorsqu'approprié ;
- fonctionnement sans rendez-vous si le module est désactivé ;
- pas de seed de salons ou comptes fictifs dans le runtime.

Écris les tests PostgreSQL/RLS : tenant A ne lit/modifie pas tenant B ; profil brouillon non public ; références étrangères cross-tenant rejetées ; données privées non exposées.

Ne lance aucune migration distante. Vérifie le backup/restore requis et signale le blocage si cette preuve manque.

Livrables : migration, snapshot/schema aligné selon conventions, types DTO/domain, tests, documentation et plan de rollback.
```

**Porte de validation :** schéma généré cohérent, tests RLS verts, migration locale testée, restauration hébergée non présumée.

---

## PROMPT 03 — Profil public, galerie et publication depuis l'ERP

```text
Construis le module ERP « Visibilité en ligne » pour que chaque salon contrôle sa fiche publique depuis son application.

Fonctions :
- créer/modifier le profil public ;
- nom, slogan, description, catégorie, commune/quartier/adresse publique ;
- téléphone/WhatsApp/email/site et réseaux sociaux facultatifs ;
- logo et couverture ;
- galerie avec limite issue de l'entitlement, six images par défaut ;
- titre/légende/alt text, ordre et suppression ;
- upload sécurisé vers stockage objet ;
- sélection des prestations publiques depuis le catalogue existant ;
- horaires et état réservation ;
- prévisualisation avant publication ;
- publication/dépublication et statuts explicites.

Contraintes :
- Gérant seul pour les changements de profil/galerie/publication ; permissions Caissier minimales ;
- ne pas stocker les binaires dans PostgreSQL/Dexie/sync ;
- upload intent signé ou mécanisme validé par ADR ; validation MIME, taille, dimensions, quota, tenant et entitlements ;
- upload incomplet ne doit pas produire un média publié ;
- la projection publique ne reçoit que les champs whitelisted ;
- suppression/dépublication invalide les caches de façon documentée ;
- aucune modification de la caisse ou des écritures financières.

UI : dashboard « Visibilité en ligne », éditeur de profil, uploader, tri de galerie, aperçu mobile/desktop et progression de publication.

Ajoute tests API, RLS, limites, erreurs, UI et intégrité des fichiers. Si aucun fournisseur de stockage n'est configuré, crée l'interface provider et un adaptateur de test local clairement identifié, sans prétendre qu'un stockage production est opérationnel.
```

**Porte de validation :** un salon peut publier une fiche et ses photos ; aucun fichier d'un autre tenant n'est lisible ou modifiable.

---

## PROMPT 04 — Portail public : landing page, annuaire et fiches SEO

```text
Construis le portail public SALON PRO selon l'architecture choisie en ADR.

Pages :
- / : landing page commerciale et recherche immédiate ;
- /salons : annuaire filtrable et paginé ;
- /salons/:slug : fiche individuelle ;
- /categories/:category ;
- /villes/:city et /villes/:city/:commune uniquement si le contenu est utile et présent ;
- /professionnels ou /tarifs pour convertir les salons vers l'ERP.

Landing : hero clair, barre de recherche, catégories, salons à découvrir, salons sponsorisés identifiés, bénéfices booking, bénéfices ERP, parcours professionnel, plans lorsqu'ils sont validés, FAQ et footer.

Annuaire : recherche nom, commune, quartier, catégorie, prestation, prix si disponibles, pagination et tri serveur. Ne pas inventer ratings, disponibilité ou salons démo en production.

Fiche : couverture, galerie, identité, description, prestations publiques, horaires, localisation, coordonnées publiées, CTA booking, appel/WhatsApp et partage.

SEO : SSR/SSG selon choix, metadata unique, canonical, sitemap dynamique des profils publiés, robots, Open Graph, alt, structured data véridiques, pages rapides et liens internes.

Contraintes :
- utiliser exclusivement les APIs publiques et DTOs ;
- ne jamais lire les tables métier privées depuis Next.js ;
- brouillon/suspendu/inéligible = absent des résultats et sitemap ;
- sponsorisé explicitement étiqueté ;
- pagination et filtres serveur ;
- mobile-first et accessibilité ;
- état erreur/vide/chargement complet ;
- aucun compte client nécessaire pour naviguer.

Respecte le design system établi et les CSP/origines nécessaires. Ajoute tests composants, API et E2E des principaux parcours.
```

**Porte de validation :** un visiteur anonyme peut trouver un salon publié, ouvrir sa fiche et partager l'URL. Aucun champ privé ne transite dans les réponses.

---

## PROMPT 05 — Booking Engine : disponibilité, réservation publique et concurrence

```text
Implémente le domaine réservation, indépendant de la caisse.

Fonctions :
- paramètres réservation par salon ;
- horaires réguliers et exceptions ;
- pauses et indisponibilités employé ;
- durée de prestations/variantes ;
- choix collaborateur ou attribution automatique ;
- calcul serveur des créneaux ;
- wizard public court ;
- réservation invité sans compte obligatoire ;
- référence sécurisée ;
- statuts pending/confirmed/rejected/cancelled/completed/no_show ;
- idempotence ;
- notifications via outbox.

Règles impératives :
- aucune confiance dans le créneau envoyé par le navigateur ;
- le serveur recalcule durée, règles, droits et disponibilité ;
- transaction et verrou contre les doubles bookings ;
- gérer les rendez-vous sans employé par une ressource salon ;
- mêmes bornes temporelles et timezone dans les calculs ;
- même idempotency key + même payload = résultat canonique ; même clé + payload différent = rejet ;
- aucun rendez-vous ne crée de recette ;
- réservation désactivable par flag/entitlement indépendamment de la caisse.

Anti-abus : rate limit, honeypot ou challenge adaptatif, validation de contact, limites de fréquence et protection référence.

Tests obligatoires : concurrence simultanée sur même ressource, deux ressources distinctes, fermeture exceptionnelle, pause, durée cumulée, changement d'heure/date, idempotence, payload modifié, tenant isolé, plan non autorisé, profil dépublié.

Livrables : service domaine, API, transactions SQL, DTOs, tests et documentation du moteur de disponibilité.
```

**Porte de validation :** deux demandes concurrentes ne peuvent pas confirmer le même créneau pour la même ressource. Les scénarios de fuseau horaire et d'horaires exceptionnels passent.

---

## PROMPT 06 — Agenda ERP, notifications et conversion vers caisse

```text
Intègre les réservations dans l'ERP existant sans transformer l'agenda en dépendance de la caisse.

Interface :
- agenda jour/semaine/mois ;
- liste et recherche ;
- demandes en attente ;
- confirmation, refus, annulation et reprogrammation ;
- affectation employé ;
- plages bloquées et horaires ;
- détail d'un rendez-vous avec client, prestations et historique ;
- notifications non lues et outbox/états d'envoi lorsque disponibles.

Permissions : le Gérant gère configuration et règles ; le Caissier/Réception traite les actions autorisées sans accéder à la paie, aux commissions privées ou aux données inutiles.

Conversion :
- rendez-vous marqué completed ;
- action explicite « Créer le ticket » ;
- créer un draft ticket ou préparer le checkout selon le contrat serveur actuel ;
- revalider services/prix/durée et disponibilité du personnel selon les règles ;
- relier ticket canonique à l'appointment ;
- idempotence : une réservation ne crée pas plusieurs tickets ;
- le chiffre d'affaires est comptabilisé uniquement par le checkout confirmé ;
- si checkout serveur non disponible, afficher un état explicite, ne pas inventer une vente confirmée.

Ne contourne jamais les routes checkout/quote/commit et les files persistantes. N'effectue aucune écriture financière directe à partir de l'appointment.

Ajoute tests de rôles, transitions, calendrier, changement de compte, rendez-vous multi-postes et conversion idempotente.
```

**Porte de validation :** le salon voit et gère ses rendez-vous ; une conversion réussie aboutit à un seul ticket confirmé ; l'agenda désactivé ne bloque pas la caisse.

---

## PROMPT 07 — Control Plane SaaS, onboarding, plans et entitlements

```text
Construis le control plane SaaS sans mélanger la facturation SALON PRO avec les ventes encaissées par le salon.

Périmètre :
- onboarding d'un nouvel établissement ;
- création atomique organisation + tenant + propriétaire/membership ;
- slugs et identité de tenant ;
- plans configurables ;
- entitlements centralisés ;
- période d'essai configurable si décidée ;
- souscription et événements d'abonnement ;
- activation manuelle auditable pour le pilote ;
- vues administrateur plateforme ;
- vue de l'abonnement côté gérant ;
- état past_due/grace/suspended/cancelled ;
- règles de visibilité/publication/booking reliées aux entitlements.

Contraintes :
- admin SaaS distinct des rôles Gérant/Caissier ;
- ne pas donner à l'admin plateforme un accès métier général aux données privées ;
- aucune simulation de paiement confirmé ;
- chaque opération manuelle est auditée ;
- les droits sont calculés et vérifiés côté backend ;
- annulation/suspension ne supprime jamais les données ;
- rendez-vous déjà confirmés restent consultables et traitables ;
- onboarding atomique, idempotent et protégé contre doublons email/tenant.

Ne sélectionne pas de fournisseur de paiement sans benchmark et décision explicite. Prépare les interfaces d'adaptation mais n'implémente pas un faux webhook.

Tests : création concurrente, doublons, élévation privilège, changement de plan, expiration, grâce, suspension, réactivation, suppression interdite, profil public/booking gated.
```

**Porte de validation :** les droits de chaque salon sont cohérents sur l'ERP, le portail, l'API et l'administrateur. Le mode pilote manuel est audité et clairement distinct d'un paiement automatisé.

---

## PROMPT 08 — Boost, QR codes, analytics et avis vérifiés

```text
Implémente les fonctions de croissance progressivement, uniquement après validation des profils, bookings et abonnements.

A. Boost / visibilité sponsorisée :
- campagne avec période, statut, emplacement et tarif configuré ;
- vérification entitlement et paiement/activation manuelle auditée ;
- début/fin serveur ;
- affichage clairement sponsorisé ;
- classement organique préservé ;
- arrêt/expiration fiable.

B. QR code :
- génération par fiche et éventuellement par destination booking ;
- téléchargement et partage ;
- URL canonique sans données privées ;
- tracking uniquement si documenté.

C. Analytics :
- vues de fiche ;
- clics booking/téléphone/WhatsApp ;
- réservations demandées/confirmées/terminées ;
- conversions ;
- métriques campagnes ;
- définitions et périodes de reporting ;
- agrégation et limitation PII.

D. Avis vérifiés (phase séparée si trop large) :
- uniquement après rendez-vous completed ;
- règles de nombre d'avis ;
- modération, signalement, réponse salon ;
- aucun faux avis ou note générée.

Tests : campagne hors période non affichée, plan non éligible rejeté, label sponsorisé, événement dupliqué dédupliqué, données analytics anonymisées/agrégées, review sans appointment completed rejetée.
```

**Porte de validation :** chaque fonctionnalité commerciale est mesurable, transparente et fondée sur des données réelles.

---

## PROMPT 09 — QA globale, hardening, déploiement et pilote

```text
Prépare SALON PRO Marketplace & Booking pour un pilote contrôlé.

1. Rejoue lint, build, tests, schema check et CI.
2. Ajoute E2E navigateur sur parcours public et ERP.
3. Teste isolation multi-tenant avec au moins deux tenants réels de test séparés.
4. Teste upload, publication, dépublication, cache, sitemap et sécurité médias.
5. Teste réservation simultanée multi-connexion réelle PostgreSQL.
6. Teste l'expérience mobile, accessibilité et performance.
7. Vérifie cookies, CORS, CSP, CSRF, HTTPS et domaines.
8. Vérifie backups et restauration sur base isolée avant migration distante.
9. Vérifie la politique de conservation et les textes de confidentialité/conditions avec les responsables compétents.
10. Ajoute logs, métriques, alertes, outbox retry et runbooks.
11. Vérifie les kill switches et la désactivation du booking sans impact sur la caisse.
12. Définis un pilote progressif avec salons partenaires, critères de sortie et procédure de rollback.

Ne déclare pas GO si une validation est seulement simulée, locale ou non prouvée. Liste les contrôles réellement exécutés et ceux qui exigent un environnement externe.

Livrables : docs/marketplace/09_GO_NO_GO.md, runbooks, matrice de tests, résultats d'E2E, procédure déploiement/rollback et décision GO/PARTIAL/NO-GO.
```

**Porte de validation :** GO uniquement si sauvegarde/restauration, isolation, concurrence réelle, HTTPS, sécurité, monitoring et parcours métier sont effectivement vérifiés.

---

# 16. Stratégie MVP et ordre de lancement commercial

## 16.1 MVP recommandé

Le premier lancement doit fermer une boucle de valeur complète, avec un nombre limité de salons partenaires.

Parcours MVP :

1. un propriétaire dispose d'un tenant et d'un compte Gérant ;
2. son abonnement/activation pilote lui autorise la visibilité ;
3. il crée son profil ;
4. il ajoute jusqu'à six photos de galerie et choisit sa couverture ;
5. il sélectionne les prestations visibles depuis son catalogue existant ;
6. il publie sa fiche ;
7. la fiche apparaît dans l'annuaire public ;
8. un visiteur consulte les photos et tarifs ;
9. il envoie une réservation ;
10. le gérant reçoit et traite la demande dans l'agenda ;
11. le rendez-vous réalisé est relié à un checkout confirmé ;
12. le propriétaire visualise les vues et demandes reçues.

## 16.2 Pilote initial

Démarrer avec environ cinq salons partenaires choisis pour tester différents cas : barbershop, salon de coiffure, institut et établissements avec plusieurs collaborateurs.

Ce chiffre est un objectif de pilote proposé, pas un engagement commercial. Les établissements doivent donner leur accord à la publication de leurs photos et coordonnées.

## 16.3 Ce qui peut attendre

Pour protéger le délai et la qualité du MVP, reporter :

- avis publics et notation ;
- campagnes publicitaires complexes ;
- paiement en ligne de l'acompte ;
- programme de fidélité client ;
- application mobile client native ;
- messagerie instantanée intégrée ;
- recommandations IA ;
- commission transactionnelle sur chaque rendez-vous.

---

# 17. Mesures de succès

Suivre des KPI produit et business définis sans ambiguïté.

## Acquisition B2B

- salons inscrits ;
- salons ayant complété leur profil ;
- salons publiés ;
- taux d'activation ;
- conversion essai → abonnement payant si applicable ;
- churn et réactivation.

## Usage B2C

- visites annuaire ;
- recherches effectuées ;
- consultations de fiches ;
- clics réservation ;
- demandes envoyées ;
- rendez-vous confirmés ;
- rendez-vous terminés ;
- taux d'abandon du formulaire.

## Valeur salon

- vues par salon ;
- demandes générées ;
- taux confirmation ;
- rendez-vous terminés ;
- clics WhatsApp/téléphone ;
- performance boost.

## Santé technique

- taux d'erreur API ;
- temps de réponse ;
- échec upload ;
- conflit de réservation ;
- backlog notification ;
- taux d'event webhook rejeté ;
- incidents cross-tenant ;
- fraîcheur des profils publics.

Ne pas utiliser un nombre de vues comme preuve de revenus supplémentaires. Les tableaux de bord doivent préciser les définitions et limites des indicateurs.

---

# 18. Décisions restant à arbitrer explicitement

L'agent doit signaler ces décisions dans les ADR ou le backlog, sans inventer une réponse :

1. Domaine public et domaine ERP définitifs.
2. Application Next.js dans le repository ou repository séparé.
3. Fournisseur de stockage média et coût associé.
4. Nombre d'images inclus par offre (six par défaut dans le MVP).
5. Nom et contenu exacts des offres commerciales.
6. Prix et périodicité des abonnements.
7. Durée d'essai et période de grâce.
8. Politique publication/suspension après impayé.
9. Confirmation manuelle ou automatique des réservations par défaut.
10. Politique d'annulation et délai minimum.
11. Acompte en ligne ou paiement sur place.
12. Fournisseur SMS/WhatsApp/email et coût.
13. Vérification éventuelle des salons et badges autorisés.
14. Politique de conservation des contacts et rendez-vous.
15. Politique de modération des photos, descriptions et avis.
16. Prestataire de paiement réellement disponible et adapté au marché ivoirien.
17. Politique de boost, inventaire publicitaire et tarifs.

L'agent peut proposer des options et une recommandation, mais ne doit pas coder une décision commerciale non validée comme si elle était acquise.

---

# 19. Récapitulatif des règles absolues

1. **Préserver l'ERP existant.** La marketplace est une extension, pas une réécriture.
2. **Un seul backend de référence.** Pas de base publique parallèle non maîtrisée.
3. **Public ne signifie pas privé accessible.** Seuls les champs publiés et whitelistés sont exposés.
4. **Le tenant est toujours résolu côté serveur.** Jamais de confiance au tenant ID du client.
5. **Les images vivent dans un stockage objet.** La base conserve leurs métadonnées.
6. **Six images par défaut.** Limite pilotée par entitlement.
7. **Les disponibilités sont recalculées côté serveur.** La concurrence doit être protégée par transaction et verrou.
8. **Un rendez-vous n'est pas une vente.** Seul le checkout confirmé alimente les recettes.
9. **Les abonnements sont un domaine SaaS séparé.** Ne pas mélanger avec les recettes du salon.
10. **Le sponsorisé est identifié.** La publicité ne doit pas être déguisée en classement organique.
11. **Les clients peuvent réserver sans compte obligatoire.** Leur confidentialité reste protégée.
12. **Les données ne sont jamais supprimées pour impayé.** Suspendre les droits, conserver l'historique.
13. **Pas de migration distante sans backup ET restore vérifiés.**
14. **Pas de déclaration de production sans preuve.** Les tests locaux ne prouvent pas HTTPS, multi-postes, webhooks ou restauration hébergée.
15. **Chaque phase possède une porte de validation.** L'agent s'arrête si la porte n'est pas franchie.

---

# 20. Références internes du repository

À relire avant chaque phase, selon le périmètre :

- `AGENTS.md`
- `README.md`
- `IMPLEMENTATION_PROGRESS.md`
- `docs/ANALYSE_ECARTS_CAHIER_DES_CHARGES.md`
- `docs/BASELINE_REFONTE.md`
- `docs/CHECKOUT_SERVEUR.md`
- `docs/reference/SALON_PRO_Cahier_des_charges_et_plan_refonte.md`
- `src/app/router.tsx`
- `src/domain/models/index.ts`
- `src/db/repositories/salonRepositories.ts`
- `server/apiHandler.ts`
- `server/tenancySchema.ts`
- `server/tenantContext.ts`
- `supabase/migrations/`
- `src/test/` et les tests PostgreSQL/RLS concernés
- `SUPABASE_SETUP.md`
- `VERCEL_SETUP.md`
- `PWA_TESTING.md`

Références GitHub :

- Repository : <https://github.com/ErwinssKoffi/barbershop>
- README : <https://github.com/ErwinssKoffi/barbershop/blob/main/README.md>
- Audit des écarts : <https://github.com/ErwinssKoffi/barbershop/blob/main/docs/ANALYSE_ECARTS_CAHIER_DES_CHARGES.md>
- Routeur : <https://github.com/ErwinssKoffi/barbershop/blob/main/src/app/router.tsx>
- Modèles de domaine : <https://github.com/ErwinssKoffi/barbershop/blob/main/src/domain/models/index.ts>

---

**Fin du document — SALON PRO Marketplace & Booking / AI Development Playbook v1.0**
