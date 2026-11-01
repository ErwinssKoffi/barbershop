# PROMPT 00 — Audit du repository et plan d’intégration

Date : **1er novembre 2026**. Périmètre : lecture, vérification locale et plan uniquement.

## 1. Référence et méthode

Cahier des charges directeur : [`SALON_PRO_Marketplace_Booking_AI_Implementation_Playbook.md`](../SALON_PRO_Marketplace_Booking_AI_Implementation_Playbook.md), **1 942 lignes lues intégralement**, y compris les exigences fonctionnelles, sécurité, exploitation et les PROMPT 00–09. Seul le **PROMPT 00** est exécuté ici.

- Branche auditée : `arena/1bd00d86-barbershop` ; HEAD : `e191a1d9235471bc937c6a2ca21a4060020d721f`.
- État initial : `git status --short` et diff vides ; un seul commit visible dans l’historique local. Aucun nettoyage, reset, changement de branche, commit ou push effectué.
- Vérification GitHub en lecture : `main` pointe aussi vers ce commit. Le blob Git local du playbook et celui de `main` sont identiques : `01fab7991e3ef092f2e1848423c19fbeafca5317`. Pas de supposition fondée sur les anciennes branches.
- Documents relus : `AGENTS.md`, `README.md`, `IMPLEMENTATION_PROGRESS.md`, `docs/ANALYSE_ECARTS_CAHIER_DES_CHARGES.md`, `docs/BASELINE_REFONTE.md`, `docs/CHECKOUT_SERVEUR.md`, `SUPABASE_SETUP.md`, `VERCEL_SETUP.md`, `docs/BOOKING.md`, `docs/PWA_TESTING.md`.
- Inspection : routeur, modèles, repositories et schéma Dexie, API Node, authentification/sessions/tenants, registre et définitions SQL 001–008, fichiers SQL Supabase, export de schéma, composants/styles, configurations Vite/Vercel/PWA/CI et tests concernés (notamment booking, migrations, isolation, sécurité).
- Baseline fraîche : voir [`00_BASELINE_RESULTS.md`](00_BASELINE_RESULTS.md). Les preuves citées ci-dessous sont relatives à la racine du dépôt.

**Niveaux de preuve :** « codé » = présence et inspection du code ; « testé localement » = suite fraîche verte ; « hébergé historique » = observation antérieure consignée, non revérifiée ici ; « hébergé actuel » = preuve distante de ce passage. Aucun test local ne vaut recette en production.

## 2. Synthèse et corrections des constats anciens

1. **Un ERP existe et doit être conservé**, pas remplacé : React 19 / React Router / Vite 8, API Node partagée dev/Vercel, PostgreSQL via `pg`, Dexie, synchronisation delta, PWA, caisse et paie. Le dépôt ne contient pas d’application Next.js.
2. **L’agenda interne existe réellement**, contrairement aux formulations anciennes « agenda absent/à faire ». Route `/booking`, API privée, migration **008 optionnelle**, audit et idempotence sont présents et testés. Le bon point de départ est son extension contrôlée, pas un second moteur indépendant.
3. **Le catalogue possède déjà des durées**, au niveau prestation et variante (`ServiceCatalogItem`, `ServicePriceVariant`). Mais l’agenda utilise une durée saisie manuellement, pas une disponibilité dérivée du catalogue.
4. **Un fuseau existe déjà en SQL** : `tenants.timezone`, par défaut `Africa/Abidjan`. Il n’est pas exploité par l’agenda : les champs `datetime-local` et les limites de journée suivent le navigateur. Il manque son contrat de configuration et son application au moteur, pas nécessairement une nouvelle colonne.
5. **Identité salon privée ≠ profil public**, projection employé Caissier ≠ annuaire public, paiements de tickets ≠ facturation SaaS, logo Data URL ≠ pipeline média.
6. **La CI du commit audité est verte**, vérifiée sur GitHub ; les anciennes mentions de validation en cours ne décrivent plus cette référence. Cela ne prouve ni déploiement ni connexion DB hébergée.
7. **Baseline locale verte mais DB locale non configurée** : 402 tests / 50 fichiers, schéma/lint/build OK ; `db:check` sort 1 avec `missing_configuration`. Production reste **No-Go**.

## 3. Architecture constatée et surfaces à préserver

### Application et stockage local

`src/app/router.tsx` place les modules ERP dans `MainLayout` avec fournisseurs auth/sync/caisse. `/login` et `/register` sont distincts, mais aucune landing commerciale, route annuaire, fiche SEO ou réservation publique n’existe. `RequireAuth` autorise explicitement le mode où `authEnforced` est faux : ce mécanisme local ne doit pas devenir l’autorisation du portail/API publique.

`src/db/database.ts` conserve le métier dans Dexie ; `src/db/accountWorkspace.ts` partitionne par salon/compte/rôle. C’est une isolation logique, **pas un chiffrement ni une sandbox entre utilisateurs d’un même profil navigateur**. `src/db/repositories/salonRepositories.ts` porte les écritures locales, la purge historique, les tombstones, les backups et les enveloppes sync. Il ne contient pas de tables booking/SaaS/publication. L’agenda reste serveur uniquement, sans repli local ni file hors ligne.

`exportBackupPayload()` exporte l’état local, **pas les bookings PostgreSQL**. Ajouter une galerie dans cet export ou la sync complète serait une mauvaise extension : garder les octets dans du stockage objet et les métadonnées dans les nouveaux contrats dédiés. Conserver les données et comportements existants de purge/tombstones.

### API, sécurité et schéma

`api/[...route].ts` délègue à `server/apiHandler.ts`, aussi utilisé via `server/viteApiPlugin.ts`. API JSON `no-store`, bearer capturé côté client, session vivante et appartenance active relues côté serveur. `server/tenantContext.ts` impose transaction, rôle runtime sans BYPASSRLS et contexte tenant. `server/neonClient.ts` cible le schéma privé `salon_pro` pour Supabase et vérifie TLS pour les hôtes distants. « Neon » dans certains noms est un héritage, pas une preuve de dépendance à ce fournisseur.

`server/tenancySchema.ts` impose FORCE RLS aux **18 tables métier** ; `server/syncSchema.ts` l’étend au journal. Les tables globales d’identité/sessions/organisations/appartenances ne suivent pas toutes ce même régime : `salon_users` a notamment la RLS désactivée pour l’authentification serveur. **Ne pas prétendre que toutes les tables sont RLS tenant-scoped**, ni ouvrir un accès navigateur à ce schéma. Les contrats publics futurs doivent être des allowlists, jamais `payload_json`/sync réutilisés directement.

`server/migrations.ts` applique 001–005 au socle ; 006 checkout, 007 refunds et 008 booking sont opt-in. 007 implique 006 ; 008 est indépendante. `ensureNeonSchema` est encore utilisé sur des parcours API pour le socle : aucune nouvelle migration marketplace ne doit être ajoutée implicitement à une requête publique. `db/schema.sql` est un snapshot généré incluant **toutes** les optionnelles, pas un script de déploiement à appliquer aveuglément.

### UI et expérience

Réutilisables : `src/components/ui/{button,input,select,card,tabs,Modal,EmptyState}.tsx`, patterns/reui, `src/styles/{variables,global}.css`, `src/lib/motion.ts`. Le système existant est light-first, sidebar sombre et accent vert ; garder l’identité ERP. Pas de composants galerie/publication/créneaux/abonnements opérationnels. Une extraction partagée éventuelle doit rester ciblée, sans déplacer les contextes privés dans le portail.

Les tests UI sont jsdom, pas une recette mobile/accessibilité réelle. Le `Modal` a un rôle dialog et Escape mais pas de gestion explicite complète du piégeage/restauration du focus : prévoir audit clavier/lecteur d’écran, contrastes et reduced-motion avant réemploi public. Le build avertit sur le bundle principal : ne pas annoncer de budget Core Web Vitals atteint.

## 4. Matrice exigence / état réel / preuve / écart / risque / phase proposée

Pour les fonctions absentes, la preuve est l’inventaire convergent **routeur + routes API + modèles + registre SQL + tests**, pas simplement l’absence d’un fichier portant le nom attendu. Aucun test marketplace absent n’est présenté comme passé.

| Exigence | État réel | Preuve dans le dépôt / tests existants | Écart | Risque | Phase proposée |
|---|---|---|---|---|---|
| ERP financier sans régression | Codé et testé localement ; activation financière volontaire | `src/features/cash/`, `server/checkout*.ts`, `src/test/checkoutCommit.test.ts`, `checkoutRefund.test.ts`, `financialAcceptance.test.ts` | Pas de recette hébergée prouvée ici | Critique : perte/double écriture | Invariant 01–09 |
| Multi-tenant privé | RLS métier, runtime restreint, appartenance/session | `server/{tenancySchema,tenantContext,sessions}.ts`, `src/test/{tenantIsolation,sessions}.test.ts` | Nouveau read model public et FK composites à concevoir | Critique : fuite inter-salon | 01–02 |
| Landing commerciale / SEO B2B | Absente ; SPA ERP seulement | `src/app/router.tsx`, `package.json`, `vercel.json` ; aucun test dédié | App publique SSR/SSG et CTA à créer | Fort : indexation/routeur privé | 01, 04 |
| Annuaire, filtres et fiche salon SEO | Absents | Même inventaire ; pas de `/api/public/*` dans `server/apiHandler.ts` | Recherche paginée, slugs, canonicals, sitemap, métadonnées/OG/JSON-LD | Fort : PII/cache/indexation | 02, 04 |
| Profil public brouillon/publié/dépublié | Absent ; `SalonInfo` privé contient coordonnées/logo/manager | `src/domain/models/index.ts`, `src/features/settings/SettingsPage.tsx` ; tests `repositoryAndUi.test.tsx` ne prouvent pas de publication | DTO public minimal, états, validation, modération, invalidation | Critique : publication involontaire | 02–03 |
| Médias : couverture, galerie, logo public | Logo privé Data URL seulement | `SettingsPage.tsx` (`FileReader`), `SalonInfo.logoDataUrl`, sync repository | Stockage objet, upload autorisé, contrôles type/taille/contenu, EXIF, variantes, suppression | Fort : contenu malveillant/coûts | 01–03 |
| Services réservables et prix publics | Catalogue privé, variantes et durées existants | `src/domain/models/index.ts`, repository `saveService`, `src/test/servicesConfig.test.tsx` | Projection publique séparée et règles durée/prix réservables | Fort : exposer commissions/consommables | 02–03, 05 |
| Horaires d’ouverture récurrents | Absents | Modèles, `server/migrations.ts`, `BookingPage.tsx` annonçant la saisie manuelle | Semaine, pauses, fermetures, exceptions et validation | Fort : réservations impossibles à honorer | 02–03, 05 |
| Fuseau salon | Colonne SQL présente, affichage navigateur | `server/tenancySchema.ts`, `BookingPage.tsx`, `server/booking.ts` | Lire/configurer IANA, convertir et tester DST/limites de jour | Fort : décalages horaires | 01–02, 05 |
| Agenda interne / RDV | **Codé et testé**, défaut off | `src/features/booking/BookingPage.tsx`, `src/lib/bookingClient.ts`, `server/booking.ts`, `src/test/booking*.test.*` | UI simple sur jour/employé ; pas agenda public | Moyen : repartir inutilement de zéro | Réutiliser en 05–06 |
| Absences/blocages | `kind=unavailable`, intervalle ponctuel 5–480 min | `src/domain/booking.ts`, `server/booking.ts`, `src/test/booking.test.ts` | Récurrence, congé multi-jour, articulation horaires | Fort : fausse disponibilité | 02, 05–06 |
| Anti-chevauchement et idempotence | Transaction + verrou tenant + clé/hash/acteur ; version à l’update | `server/booking.ts`, `server/bookingSchema.ts`, `booking.test.ts` | Pas de contrainte SQL d’exclusion ; pas de preuve multi-connexion réelle | Critique : double booking ; débit sérialisé par salon | ADR 01, 02, 05, 09 |
| Cohérence références booking | Vérification employé/service actifs sous contexte tenant | `employee()` / `createBooking()`, `bookingSchema.ts`, tests conflit/isolation | Pas de FK SQL composite employé/prestation ; snapshots en JSON | Fort : écriture hors API/références invalides | ADR 01, 02, 05 |
| Audit et cycle de vie | 6 statuts, version, événements before/after ; pas suppression runtime | `src/domain/booking.ts`, `server/bookingSchema.ts`, `booking.test.ts` | Plusieurs services, transfert employé, origine publique et modèle cible à arbitrer | Fort : perte d’historique en migration | 01–02, 05–06 |
| Réservation publique / disponibilité | Absentes ; API actuelle exige session privée | `server/apiHandler.ts` routes `/api/booking/list|create|update`, tests droits | Moteur de créneaux, revalidation atomique, contact/consentement, confirmation | Critique : conflit/abus/PII | 05 |
| Anti-abus public | Rate limit auth et booking privé existants | `server/authRateLimit.ts`, `apiHandler.ts` (booking 120/min par tenant/user) | Limites publiques adaptées, IP/proxy, bot, taille/horizon, jetons opaques | Fort : déni de service/spam | 01, 05, 09 |
| Annulation / déplacement | Manager privé ; même employé ; pas client autonome | `server/booking.ts`, `BookingPage.tsx`, `booking.test.ts` | Politique commerciale et lien client signé/expirant | Fort : annulation frauduleuse | 01, 05–06 |
| RDV vers caisse | **Absent** ; aucun effet financier d’une réservation/fin de RDV | `booking.test.ts` compare l’état financier avant/après | Handoff explicite et idempotent vers commande existante ; prix validés serveur | Critique : double vente | 06 |
| Notifications / rappels | Absents | Pas d’outbox notification au registre/routes ; `checkoutOutbox` est financier | Outbox dédiée, worker, retries/déduplication, fournisseur et consentement | Fort : notification perdue/PII | 02, 06 |
| Onboarding nouveau salon | Bootstrap tenant + gestion comptes, pas provisioning SaaS autonome | `server/{tenancySchema,authEngine}.ts` (`defaultTenantId`), `src/features/auth/` | Onboarding transactionnel organisation/tenant/manager, reprise existant | Critique : rattachement au mauvais salon | 01–02, 07 |
| Plans / abonnements / entitlements | Absents | `server/migrations.ts`, `src/domain/models/index.ts`, routes API ; aucun test SaaS | États, droits centralisés serveur, quotas, trial/grâce, audit | Fort : droits contournables | 01–02, 07 |
| Facturation SaaS / paiement | Absents ; paiements ERP ne sont pas abonnements | Registre/routes et `src/domain/models/index.ts` | Fournisseur, preuve webhook signé/idempotent ou pilote manuel audité | Critique : activation/argent sans preuve | 07, selon arbitrages |
| Boost ponctuel séparé du récurrent | Absent | Aucun modèle/campagne/route marketing | Durée, éligibilité, étiquette sponsorisée, classement équitable | Fort : droits/classement trompeurs | 08 après socle |
| QR / partage WhatsApp / analytics | Pas de parcours marketplace | Router/API et tests inventoriés | Liens canoniques, QR réels, événements agrégés sans PII | Moyen : fausses métriques | 04, 08 |
| Avis vérifiés | Absents | Pas de modèle/route/test avis | Lier RDV accompli, unicité, modération/abus | Fort : faux avis et données privées | 08, différable |
| Séparation public/privé et cache | `no-store` API, PWA shell sans API/auth | `server/{apiHandler,pwaBuild}.ts`, `src/test/pwa.test.ts` | Publication/cache/invalidation publique à concevoir ; SW scope `/` à isoler | Critique : fuite/cache privé ou interception portail | 01, 04, 09 |
| Exploitation / restauration / HTTPS | Scripts et recettes documentés ; non validés ici à distance | `server/{checkDatabase,cloudReadiness}.ts`, tests `cloudReadiness.test.ts`, docs Cloud | DB runtime, restore, déploiement isolé, concurrence, supervision | Critique : No-Go production | 09, préparation dès 01 |

### Détail du booking à conserver

La migration 008 crée `bookings` et `booking_events`, PK tenant-scoped, unicité `(tenant_id, request_key)`, dates `timestamptz`, RLS ENABLE/FORCE, révocation navigateur et événements sans UPDATE/DELETE pour le runtime. `createBooking` verrouille **le salon entier** avant lecture d’idempotence/disponibilité et écrit booking + événement dans la même transaction ; rollback si audit impossible. `updateBooking` exige `expectedVersion`. Les chevauchements excluent `cancelled` et `no_show`, et autorisent les bornes adjacentes.

Limites vérifiées : une seule prestation sans variante dans le contrat, snapshots de nom/service mais pas de prix de réservation, durée manuelle, pas d’horaires, contacts/notes dans le JSON privé. Liste limitée à 31 jours / 200 éléments et drapeau `truncated` ; ne jamais calculer des créneaux publics en soustrayant simplement cette liste tronquée. Écriture Gérant, lecture Caissier, aucune session client public. La clé d’intention survit à une erreur réseau **dans le composant**, pas à sa fermeture/rechargement ; aucune garantie de file offline booking. Ne pas confondre test d’ordre du verrou PGlite et vraie course PostgreSQL.

## 5. Inconnues et blocages à lever explicitement

| ID | Inconnue / preuve manquante | Effet et porte requise |
|---|---|---|
| B01 | Connexion Node vers PostgreSQL dans l’environnement cible ; ici `missing_configuration` | Pas de Go hébergé. Configuration via réglages privés, puis check en lecture ; ne pas demander de secrets en conversation. |
| B02 | Backup PostgreSQL complet et restauration réellement exécutée, objectif RPO/RTO | Bloque tout DDL distant ; l’export JSON Dexie ne sauvegarde pas 008. |
| B03 | Inventaire actuel distant, privilèges runtime et statut 006/007/008 | Les docs rapportent 001–005 et optionnelles non appliquées ; à revérifier avant migration volontaire, sans écriture. |
| B04 | Déploiement réel Vercel, environnement Preview isolé, DNS/TLS/domaines et cookies | Paramètres versionnés ≠ déploiement ; secrets Production historiques ≠ secrets Preview ni connectivité. |
| B05 | Politique de reprise des bookings existants et garantie de concurrence | Choisir évolution `bookings` ou migration vers `appointments`, jamais deux sources de vérité concurrentes ; test multi-connexion requis. |
| B06 | Horaires, durée/variantes, buffers, pas de créneau, horizon/délai minimum, annulation/no-show, choix employé | Règles à valider avant moteur public ; aucun chiffre commercial ou métier inventé. |
| B07 | Publication/modération, droits sur les photos, limites galerie, stockage/CDN et suppression | Fournisseur/bucket/quotas/coûts et responsabilités à arbitrer avant médias. |
| B08 | Plans, prix XOF, quotas/droits, essai/grâce, impayés, entité facturante et fournisseur paiement | Bloque l’activation payante ; pilote manuel seulement si validé et audité. Pas de valeurs fictives runtime. |
| B09 | Fournisseur notifications, canaux, consentement, conservation des contacts/notes, suppression/anonymisation, obligations locales | Bloque envoi réel et collecte publique non cadrée ; aucune donnée privée dans analytics/URL/logs. |
| B10 | HTTPS navigateurs réels, postes simultanés, vraie concurrence PostgreSQL, charge, accessibilité et observabilité | Bloque lancement/pilote, pas la rédaction des ADR. Un test jsdom ou une CI verte ne suffit pas. |

**État distant :** aucune lecture Supabase/Vercel live ni modification distante dans cet audit. Les constats historiques sont uniquement ceux consignés dans `SUPABASE_SETUP.md`, `VERCEL_SETUP.md` et `docs/BOOKING.md`. Ils ne sont pas promus en preuves actuelles. La seule preuve hébergée actuelle ajoutée ici concerne GitHub (source et CI), pas le runtime applicatif.

## 6. ADR à produire en PROMPT 01 (pas encore produits ni approuvés)

1. **ADR-001 — Portail** : comparer routes publiques dans la SPA, app publique Next.js séparée, autre solution SSR/SSG ; coût de deux builds et déploiements. Recommandation à étudier : conserver l’ERP et séparer le portail SEO, conformément au playbook ; **pas une décision acquise**.
2. **ADR-002 — Read model public** : projection allowlist cross-tenant, rôle serveur de lecture dédié, brouillon/publication/modération, provenance des services et invalidation de cache. Pas de RLS `anon` sur le métier privé ni exposition de `salon_users`/sync.
3. **ADR-003 — Médias** : stockage objet, upload signé/quarantaine/validation, variantes/EXIF, droits d’accès et effacement ; métadonnées tenant-scoped, pas de base64 dans les nouveaux flux.
4. **ADR-004 — Booking et concurrence** : compatibilité 008, choix `bookings`/`appointments`, backfill/reprise audit/version/idempotence, verrou vs contrainte SQL, références tenant-scoped, statut des blocages ; un seul moteur privé/public et tests PostgreSQL multi-connexion.
5. **ADR-005 — Entitlements** : autorité centrale serveur, calcul des droits/plans/subscriptions/boosts distincts, quotas atomiques, pilote manuel audité et dégradation sûre sans bloquer les données financières historiques.
6. **ADR-006 — Domaines, cookies et CORS** : origines ERP/portail/API, reverse proxy ou CORS minimal, cookie refresh HttpOnly/Secure/SameSite=Strict actuel et chemin `/api/auth`, protection CSRF, absence de partage de tokens privés au public, séparation des SW/caches et CSP médias/SEO.

Compléter ces ADR par décisions produit documentées pour B06–B09 et un protocole d’exploitation B01–B04/B10 ; ne pas confondre choix technique provisoire et validation commerciale.

## 7. Ordre d’intégration proposé et fichiers probablement concernés

Les chemins nouveaux ci-dessous sont **indicatifs**, à confirmer par les ADR. Aucun de ces modules n’est créé par cet audit. Respecter les portes séquentielles du playbook ; ne pas anticiper un lot ultérieur sous prétexte de réutilisation.

| Phase | Travail limité et dépendances | Fichiers/surfaces probables | Porte avant suite |
|---|---|---|---|
| **00 — présent lot** | Audit, baseline, risques et plan | Les deux rapports `docs/marketplace/00_*` uniquement | Rapports relus, écarts/No-Go explicites |
| **01** | Architecture et six ADR ; contrats, découpage déploiement et UX | `docs/marketplace/01_TARGET_ARCHITECTURE.md`, `docs/marketplace/adr/*.md` | Domaines/cookies, read model, média, reprise 008 et droits validés ; aucune DB/route métier modifiée |
| **02** | Minimum de données additif pour tranche retenue ; profil, services publics, horaires, médias, évolution RDV et données SaaS/outbox seulement si nécessaires | Nouveaux `server/*Schema.ts`, `server/migrations.ts`, nouvelles SQL versionnées sous `supabase/`, `server/exportSchema.ts` si conventions à étendre, `db/schema.sql` généré, DTO/domain et tests SQL/RLS | Migration/rollback **locaux**, FK cross-tenant, brouillon privé, schéma aligné ; aucun DDL distant ; B02 bloque distant |
| **03** | Édition ERP du profil public, horaires, médias et publication explicite | Nouvelles features public-profile/media sous `src/features/`, routes ciblées dans `src/app/router.tsx` et navigation, clients/handlers privés dédiés, composants existants | Permissions serveur, validation médias, publication/dépublication, pas de fuite sync ; tests vrais états vides |
| **04** | Landing, annuaire, fiches SEO et partage avec données publiées réelles | App publique selon ADR (par ex. `apps/marketplace/`), contrat DTO partagé pur, handlers publics ; nouveaux builds/config Vercel distincts si validés | SSR/SEO canonique, pagination, cache/invalidation, profils brouillons invisibles ; ERP/PWA inchangés |
| **05** | Créneaux et réservation publique ; **étendre et unifier le moteur existant** | `server/booking.ts`, `src/domain/booking.ts` ou module partagé pur, nouveaux disponibilité/contrats publics, SQL additive décidée en ADR-004, tests de courses multi-connexion | Revalidation atomique, fuseau/DST, anti-abus, idempotence, horaire et blocage partagés, absence d’effet financier |
| **06** | Agenda ERP enrichi, notifications fiables, conversion contrôlée vers caisse | `BookingPage.tsx`, `bookingClient.ts`, moteur serveur, outbox/worker dédié ; intégration ciblée `server/checkout*.ts` et UI caisse | Déduplication notifications, lien client sûr, conversion idempotente, aucun double ticket/stock/caisse ; suite financière verte |
| **07** | Onboarding multi-salon, plans, abonnements/droits et paiement/pilote validé | Modules `server/saas/`/`src/features/saas/` proposés, autorisations serveur, provisioning distinct de l’inscription compte existante ; webhooks si fournisseur décidé | Quotas et droits côté API, transitions/audit/rejeu, isolement control plane ; aucune confusion avec recettes salon |
| **08** | Boost, QR, analytics agrégées et avis vérifiés selon priorité | Modules marketing/public dédiés et tests ; évolutions SQL additives nécessaires | Boost ≠ abonnement ; sponsorisé explicite, métriques réelles, avis vérifiés, aucune PII exposée |
| **09** | QA transversale, durcissement et pilote explicite | Tests E2E navigateur/multi-poste/PostgreSQL réel à ajouter, `.github/workflows/`, configurations déploiement ciblées, runbooks | Backup/restore, TLS/DB runtime, charge, accessibilité, supervision, rollback/kill switches et accord de lancement |

### Invariants d’intégration

- Pas de réécriture des migrations historiques ni d’application globale du snapshot. Prochain identifiant de migration à confirmer contre l’inventaire au moment du lot ; ne pas présumer une 009 déjà déployée.
- Garder les pilotes checkout/refunds/booking désactivés par défaut ; pas de nouvelle activation pendant l’audit. Déploiements et migrations séparés, explicitement autorisés, sur environnement isolé avant production.
- Pas de faux salon, faux rendez-vous, faux avis, prix de plan inventé ou métrique simulée dans le runtime. Les fixtures de tests isolées ne sont pas des seeds métier.
- Pas de connexion PostgreSQL/service-role ni de secret `VITE_*` côté navigateur ; ne pas injecter Dexie/auth privée dans la landing publique.
- La réservation ne crée aucune vente ; la caisse garde son autorité sur prix, stock, paiements et numérotation. Préserver les identifiants, données authentiques, comptes, purges et tombstones.
- À chaque lot fonctionnel futur : schéma cohérent, lint/tests/build/diff, tests d’isolation, et porte du lot documentée. Les tests existants constituent le filet de non-régression, pas la couverture des fonctionnalités nouvelles.

## 8. Conclusion du PROMPT 00

**Audit documentaire achevé**, fonctionnalités existantes distinguées des cibles, baseline fraîche consignée et risques majeurs identifiés. Le prochain travail proposé est **PROMPT 01, architecture/ADR seulement**, après revue de cet audit ; il n’a pas été commencé.

Résultat global **PARTIAL** : contrôles locaux PASS, contrôle DB BLOCKED par configuration manquante et recette hébergée non établie. **No-Go production** maintenu ; cela n’empêche pas la phase d’architecture documentaire. Aucun module métier, migration, secret, flag, donnée distante ni déploiement modifié.

**PARTIAL**
