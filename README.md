# SALON PRO — ERP de gestion de salons et instituts

Application React/TypeScript pour barbershops, salons de coiffure et instituts de beauté, avec montants entiers **XOF/FCFA**. Le dépôt existant évolue par lots ciblés, sans réécriture de ses modules métier. Les rendez-vous sont une capacité future **optionnelle**, pas une condition d’utilisation de la caisse.

> Lot 2g-a : diagnostic des remboursements bloqués, **333 tests locaux verts**, sans correction ni renvoi automatique. Aperçu dev lancé sur 4173 ; connexion PostgreSQL d’exécution non configurée dans cet environnement. Migrations 006/007 non appliquées à distance ; production No-Go maintenue. Voir le [contrat détaillé](docs/CHECKOUT_SERVEUR.md#lot-2g-a--diagnostic-des-intentions-bloquées-premier-sous-lot-sans-correction).

## Référence produit et état réel

- [Cahier des charges original — version 1.0 du 31 octobre 2026](docs/reference/SALON_PRO_Cahier_des_charges_et_plan_refonte.md) : conservé sans modification.
- [Comparaison du cahier avec le code, risques et plan d’exécution](docs/ANALYSE_ECARTS_CAHIER_DES_CHARGES.md).
- [Baseline et portes de validation](docs/BASELINE_REFONTE.md).
- [Contrat et limites du checkout serveur](docs/CHECKOUT_SERVEUR.md).
- [Suivi chronologique des implémentations](IMPLEMENTATION_PROGRESS.md).

**Ne pas confondre modules disponibles et parcours validé en production.** Les modules caisse, recettes, dépenses, prestations, personnel, paie interne, stock, rapports, budget et paramètres existent. L’encaissement complet autoritaire, ses corrections, l’onboarding SaaS, le CRM, les fournisseurs et la facturation SaaS restent à finaliser. Il n’y a pas de paiement d’abonnement simulé ni de module agenda à activer actuellement.

Le premier sous-lot du nouveau cahier ajoute un **devis serveur sans écriture financière**, `POST /api/checkout/quote`. Il ne finalise pas une vente, ne réserve pas le stock, ne consomme pas la clé d’idempotence et ne génère pas de reçu officiel. Par défaut, l’interface conserve le parcours local et l’indique explicitement.

Le sous-lot suivant ajoute `POST /api/checkout/commit` : écritures atomiques vente/stock/caisse, idempotence persistée et reçu par salon. Il exige la migration **optionnelle 006**, jamais appliquée par le démarrage de l’API. Une file durable Dexie et le formulaire commun Gérant/Caissier sont maintenant branchés en **pilote optionnel** (`VITE_SERVER_CHECKOUT=true`, désactivé par défaut). Attente/confirmation/rejet et reçu depuis le résultat canonique sont distingués ; aucun repli local automatique après erreur serveur. Aucune activation de production ni migration distante n’est revendiquée. La supervision permet maintenant de vérifier une clé via `/api/checkout/status` sans renvoyer la vente, ainsi que de sauvegarder/restaurer les intentions non confirmées dans une file suspendue avant reprise explicite. Voir le contrat pour les garanties, limites et sauvegardes requises.

La bascule peut maintenant être préparée par `/api/checkout/preflight`, avant tout pull : le diagnostic conserve les ventes locales à rapprocher. Un mode serveur **optionnel** `SALON_CHECKOUT_SYNC_MODE=enforced` ferme les écritures de vente par l’ancienne sync, avec 006 et approbation opérateur requises. Le défaut reste `legacy` ; ne pas activer sans inventaire de tous les appareils/instances et sauvegardes/restauration vérifiées. Les autres flux financiers et corrections restent à qualifier.

## Architecture conservée

- React 19, TypeScript, Vite 8, React Router ; UI existante, Framer Motion et Recharts.
- Dexie/IndexedDB : espaces métier par salon/compte/rôle, continuité locale et tombstones durables. Partition logique, **pas chiffrement ni frontière de sécurité contre un utilisateur du même profil OS/navigateur**.
- API Node : `server/apiHandler.ts`, plugin Vite local et `api/[...route].ts` sur Vercel.
- **Supabase/PostgreSQL privé `salon_pro` comme cible de référence** : migrations 001–005, isolation tenant FORCE RLS et rôle runtime restreint. Aucun accès direct du navigateur aux tables métier.
- Authentification PBKDF2/HMAC existante : accès courts, sessions révocables et cookie refresh HttpOnly rotatif. Ce n’est pas Supabase Auth.
- Synchronisation par révisions serveur et curseur, conflits archivés et projections Caissier. La voie active n’est plus un arbitrage global Last-Write-Wins fondé sur l’horloge cliente.
- PWA : précache des ressources publiques du build, sans cache API ni données financières ; activation d’une nouvelle version après fermeture des anciens clients.

Les noms internes `neonClient` / `syncWithNeonDatabase` sont historiques et restent compatibles avec PostgreSQL. Ils ne signifient pas que Neon est le fournisseur choisi. Les anciens modes PIN ne sont pas le parcours normal : utiliser une session individuelle authentifiée. Ne pas rejouer `db/schema.sql` manuellement sur une base installée.

## Installation et validation

Node **22.18+** (baseline exécutée sur 22.22.3), npm et une origine HTTPS pour les cookies de production/PWA.

```bash
npm ci
npm run dev                     # frontend et API locales
npm run db:schema:check
npm run lint
npm test
npm run build
npm run preview -- --host 0.0.0.0 --port 4173 --strictPort
```

`preview` sert le build ; ce n’est pas une preuve du déploiement HTTPS relié à Supabase. Les détails sont dans [SUPABASE_SETUP.md](SUPABASE_SETUP.md) et la [recette PWA](PWA_TESTING.md).

## Configuration Vercel

Le projet Vercel dédié **barbershop** est créé et ses paramètres Vite/indicateurs de sécurité sont configurés. **Pas encore de déploiement ni de connexion Cloud** : variables privées PostgreSQL/authentification et publication de la branche restent nécessaires. Voir [VERCEL_SETUP.md](VERCEL_SETUP.md). Après correction de l’organisation des tests, la suite complète passe à **338/338** (43 fichiers), sans augmentation des délais.

## Configuration serveur

Copier `.env.example` vers `.env.local` (privé, ignoré par Git), ou configurer les valeurs dans le gestionnaire de secrets de l’hébergement :

- `SUPABASE_DATABASE_URL` : URI PostgreSQL privée ; prioritaire si `DATABASE_URL` est aussi définie.
- `DATABASE_URL` : compatibilité PostgreSQL historique, pas une seconde base à synchroniser.
- `SALON_AUTH_SECRET` : secret aléatoire stable d’au moins 32 caractères en production, commun aux instances.

**Jamais de préfixe `VITE_` pour ces secrets**, de clé privilégiée dans le navigateur ni de mot de passe/PIN par défaut. L’accès au connecteur d’administration ne configure pas à lui seul la connexion de l’application hébergée.

Vérifier la connexion et les migrations existantes sans aucune écriture avec `npm run db:check`. Le chargement serveur accepte désormais `.env.local` et les variantes de mode ; les variables privées injectées par l’hébergement restent prioritaires. Dans cet aperçu, la commande indique toujours `missing_configuration` : aucune URI PostgreSQL n’a été fournie au processus, et un accès réseau PostgreSQL autorisé est également nécessaire. Le connecteur d’administration ne remplace ni cette URI ni cet accès. Voir [le diagnostic et les statuts](SUPABASE_SETUP.md#mise-à-jour--configuration-dexécution-31-octobre-2026).

Avant une migration ou une mise en production : sauvegarde vérifiée, répétition de restauration sur un environnement isolé, `npm run db:migrate` avec droits adaptés, puis serveur et client compatibles déployés ensemble. Ne pas rejouer les migrations Supabase déjà enregistrées. Aucun nouveau schéma distant n’est appliqué par le sous-lot de devis.

## Limites et lancement

Les tests unitaires, React/Dexie et PostgreSQL embarqué ne prouvent pas les cookies HTTPS, la concurrence réelle multi-postes, le backup/restore hébergé ni la restauration après incident. Le suivi des tests reste distinct des portes Go/No-Go du cahier. La sauvegarde locale JSON, la partition Dexie et le cache PWA ne remplacent pas une sauvegarde PostgreSQL restaurée et vérifiée.

Les exemples métier du cahier ne doivent pas devenir des comptes ou écritures de démonstration : seules les catégories structurelles sont initialisées ; les données réelles et comptes existants sont préservés.
