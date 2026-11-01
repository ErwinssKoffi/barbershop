# Analyse complète du projet — SALON PRO

**Date :** 1er novembre 2026
**Branche examinée :** `arena/80a7ead0-barbershop`
**Commit présent au départ :** `935d5e46e55bc195de4f33f3c4cd158fbe92bbc4` (`Delete supabase directory`)
**Périmètre :** produit, code client et serveur, persistance, sécurité, migrations, tests, build, CI, documentation et déploiement.
**Nature :** revue statique du dépôt et exécution locale des contrôles. Pas de connexion ni de modification d’une base hébergée.

> **Conclusion courte :** produit riche et architecture de sécurité nettement plus élaborée que ne le laissait entendre l’ancien rapport. Mais l’état du dépôt n’est pas validable tel quel : le commit courant a supprimé les scripts SQL Supabase auxquels 16 fichiers de tests font référence. Le lint et le build passent, mais `npm test` échoue (726/742 tests passent) ; la CI qui exécute cette suite sera donc bloquée. La base cloud n’est pas configurée dans l’environnement et aucune recette de production ne peut être déclarée.

## 1. Résumé exécutif

SALON PRO est un ERP web en français pour salons et barbershops, avec montants entiers en XOF/FCFA. Il combine React/TypeScript côté navigateur, Dexie/IndexedDB pour l’usage local et une API Node/PostgreSQL pour les opérations cloud. Le dépôt contient aussi les fondations d’un agenda et d’une future offre marketplace/SaaS.

| Axe | Évaluation | Constat principal |
|---|---|---|
| Fonctionnalités ERP | **Élevé** | Caisse, recettes, dépenses, prestations, personnel, paie, stock, rapports, budgets et paramètres sont présents. |
| Conception métier financière | **Solide, mais rollout incomplet** | Devis, encaissement serveur transactionnel et remboursements intégraux existent ; pilote désactivé par défaut, anciens chemins encore à fermer/qualifier. |
| Architecture | **Bonne séparation, complexité élevée** | Domaine, UI, repositories, API et schémas SQL identifiables ; plusieurs fichiers et écrans sont très volumineux. |
| Sécurité | **Bonnes protections structurantes** | Sessions signées et révocables, contrôle serveur des rôles/tenants, RLS et limites d’authentification. Ce n’est pas un audit d’intrusion. |
| Données locales | **Fonctionnelles, non chiffrées** | IndexedDB apporte l’offline-first, mais n’est pas une frontière de sécurité sur un profil de navigateur compromis. |
| Qualité automatisée au commit courant | **Échec** | 0 erreur Oxlint, build OK ; 16 fichiers de tests échouent sur des exports SQL absents. |
| Production / exploitation | **No-Go** | Aucun accès DB dans cet environnement ; sauvegarde-restauration hébergée, HTTPS, concurrence réelle et déploiement restent à prouver. |

**Priorité immédiate :** restaurer ou régénérer les scripts SQL Supabase supprimés, aligner le dépôt et sa documentation, puis refaire la suite complète. Ce problème est plus urgent que les optimisations de code : il invalide actuellement la validation CI.

## 2. Identité et inventaire technique

- **Package :** `salon-pro`, version 1.0.0, privé ; runtime demandé Node 22.x.
- **Socle :** React 19, TypeScript 7, Vite 8, React Router 7.
- **UI/visualisation :** composants maison et patterns, Framer Motion, Lucide, Recharts.
- **Persistance navigateur :** Dexie 4 / IndexedDB, espaces locaux et files de travail.
- **Serveur :** API Node commune (`server/apiHandler.ts`), adaptateur Vite en développement et handler Vercel (`api/[...route].ts`).
- **Base cible déclarée :** PostgreSQL privé `salon_pro` sur Supabase ; `pg` est le client. Les noms historiques `neon*` restent dans le code et ne prouvent pas l’usage de Neon.
- **Tests :** Vitest, Testing Library, jsdom, fake-indexeddb et PGlite pour les scénarios PostgreSQL embarqués.
- **Déploiement :** Vercel configuré dans le dépôt, PWA produite au build. Configuration ne signifie pas qu’un déploiement cloud est actif.
- **Taille :** 369 fichiers suivis ; environ 51 068 lignes combinées dans les fichiers TS/TSX/SQL de `src`, `server`, `api`, `db` et `scripts` (le snapshot SQL généré contribue au total).
- **Tests :** 84 fichiers de test. La suite a annoncé 742 cas, dont 16 en échec à cause de ressources absentes (détail section 7).

## 3. Architecture et flux de données

```text
React / routes lazy
   ├── composants métier + contextes
   ├── domaine / validations / calculs
   └── repositories SalonRepositoryHub
         └── Dexie / IndexedDB (offline-first)
                 │ API HTTP, session bearer/cookies
                 ▼
Vite middleware (dev) ou fonction API Vercel
   ├── authentification, sessions, RBAC, limites
   ├── synchronisation / projections par rôle
   ├── commandes checkout et remboursements
   └── contexte tenant et rôle PostgreSQL limité
                 ▼
PostgreSQL privé salon_pro — RLS / migrations optionnelles
```

La séparation est réelle : les vues consomment un état et des repositories plutôt que d’interroger directement IndexedDB ; le serveur n’est pas un simple miroir du client. La base locale reste importante pour la continuité et plusieurs fonctionnalités. Le modèle ne rend pas les données locales inviolables et ne chiffre pas automatiquement la base du navigateur.

La version SQL est structurée dans `server/migrations.ts` et `server/*Schema.ts`, puis agrégée dans `db/schema.sql`. Le registre comporte des migrations numérotées jusqu’à 022. Plusieurs extensions sont volontairement conditionnelles et exigent une approbation opérateur / des prérequis de sauvegarde avant exécution. Le démarrage de l’API ne doit pas être confondu avec une migration complète de production.

## 4. État fonctionnel réel

### ERP et exploitation d’un salon

Présents dans les écrans et modèles : tableau de bord, caisse, recettes, dépenses, catalogue de prestations/variantes, employés, paie interne, inventaire, rapports, budget et paramètres. La logique couvre des scénarios concrets : paiements mixtes, consommables de prestation, caisse, mouvements de stock, rémunération/avances et calculs financiers. Les tests comportent des parcours UI et domaine, mais ne constituent pas une validation comptable ou fiscale de terrain.

### Caisse et remboursements

Le dépôt contient un nouveau contrat serveur de devis sans écriture et un endpoint de commit atomique. Le commit s’appuie sur une clé d’idempotence, un résultat canonique, un numéro de reçu par salon et une transaction tenant. Un remboursement intégral utilise des écritures inverses ; la recherche des ventes canoniques multi-postes, le diagnostic et la reprise supervisée de certaines intentions sont également présents.

**Limites essentielles :** migrations 006/007 optionnelles, aucun déploiement/migration cloud démontré, pilote `VITE_SERVER_CHECKOUT` désactivé par défaut et mode de sync de coupure `legacy` par défaut. Tous les anciens chemins financiers ne sont pas encore fermés ou qualifiés ; les corrections partielles, l’exécution effective par les prestataires de paiement et la recette réelle ne sont pas garanties. Les références de paiement externe peuvent être des attestations, pas l’exécution du paiement. Les reçus/a voir imprimables sont à valider sur imprimante et avec les règles fiscales applicables.

### Agenda et marketplace/SaaS

L’agenda interne existe côté UI/API, mais reste facultatif, protégé par flags et migration dédiée ; il n’est pas une réservation publique. Les dossiers `docs/marketplace` et les modules serveur ajoutent des fondations pour profil, horaires, catalogue public, médias, visibilité/publication, abonnements, activation de plateforme et outbox de notifications.

Ce corpus n’équivaut pas à une marketplace achevée : pas de parcours public complet revendiqué, pas de réservation publique / rappels opérationnels, pas d’activation commerciale ou d’abonnement effectif démontré, ni de fournisseur de stockage média configuré. Plusieurs composants sont des primitives et contrats techniques à raccorder. Les flags sont documentés désactivés par défaut.

## 5. Sécurité et protection des données

### Contrôles positifs observés dans le code et les tests

- Authentification serveur par dérivation de mot de passe (PBKDF2) et jetons signés HMAC ; les secrets sont attendus côté serveur, pas sous `VITE_`.
- Sessions individuelles avec access token court, refresh cookie HttpOnly rotatif, stockage du hash de refresh, révocation et détection de rejeu.
- Vérification de session et de l’appartenance active au tenant à l’exécution ; le rôle est relu côté serveur, pas accepté comme autorité depuis l’interface.
- Routes métier sensibles distinctes de la synchronisation ; contrôles spécifiques Gérant/Caissier, origine des opérations sensibles, limites de tentatives et réponses API non mises en cache.
- Isolation PostgreSQL conçue autour de tenants, `FORCE ROW LEVEL SECURITY` et rôle runtime restreint. Les opérations financières tiennent compte des migrations explicitement activées.
- Politique PWA documentée sans cache d’API/données financières ; les ressources d’application ne sont pas les données métier.
- Tests couvrant notamment l’isolation tenant, la reprise d’idempotence, les sessions, les autorisations, les migrations et des scénarios transactionnels.

### Risques et limites à conserver à l’esprit

- **Dexie n’est pas chiffré** : une personne ayant accès au profil système/navigateur peut lire ou modifier ses données ; l’application ne remplace ni verrouillage du poste ni sauvegardes.
- **La compatibilité legacy demeure :** le PIN partagé/synchronisation historique est encore présent comme chemin conditionnel. Éviter son activation et finaliser la qualification des mutations qu’il peut encore transporter.
- Les tests statiques/PGlite ne remplacent pas une revue externe, un test d’intrusion, une vérification des secrets du fournisseur, ni des essais HTTPS sur les domaines réels.
- La politique CSP Vercel autorise les styles inline (`unsafe-inline`) ; à conserver en connaissance de cause et à réduire si l’application le permet.
- Les limitations/quotas de serveurless, de base et de traitements natifs médias doivent être calibrés au runtime réel avant d’exposer ces flux.

Aucune vulnérabilité critique nouvelle n’est affirmée par cette revue limitée ; cela ne vaut pas certification de sécurité.

## 6. Déploiement, données et exploitation

- `.env.example` documente la cible Supabase, la connexion PostgreSQL, le secret auth, les flags checkout/agenda/plateforme et les portes manuelles de migration. Aucun secret n’a été fourni ou ajouté pendant cette analyse.
- `npm run db:check` a renvoyé `missing_configuration` avec code de sortie 1 : aucune URI PostgreSQL n’est configurée dans cet environnement. Je n’ai donc pas exécuté `cloud:check`, de migration, de commande financière ni de test sur une instance réelle.
- Les scripts de migration peuvent s’exécuter en mode ordinaire ou par options explicites ; les options sensibles impliquent des approbations et prérequis. Une valeur d’approbation configurée n’est pas une preuve de sauvegarde en soi.
- Avant toute opération distante : sauvegarde vérifiée, restauration répétée sur environnement isolé, compatibilité client/serveur, validation des rôles/RLS, puis tests avec plusieurs appareils. Aucune de ces preuves n’est déduite du build local.
- Vercel et Supabase sont une cible, pas un déploiement confirmé. Les variables, droits DB, région, domaine HTTPS, cookies et observabilité restent à confirmer dans l’environnement réel.

## 7. Contrôles exécutés dans cette analyse

Environnement local : Node `v22.22.3`, npm `10.9.8`. `npm ci` a installé 197 paquets ; npm a indiqué 0 vulnérabilité dans son audit de dépendances à cette exécution (résultat ponctuel, pas un audit complet).

| Contrôle | Résultat | Détail |
|---|---|---|
| `npm run lint` | **PASS** | Oxlint : 0 avertissement, 0 erreur, 302 fichiers. |
| `npm run build` | **PASS** | TypeScript + Vite ; le build génère les assets PWA. |
| `npm run db:schema:check` | **PASS** | Snapshot `db/schema.sql` identique au registre de migrations serveur. |
| `npm test` | **FAIL** | 84 fichiers ; **726/742 tests passés**, 16 échoués dans 16 fichiers. Les erreurs observées sont `ENOENT` sur les exports SQL Supabase supprimés, pas des échecs d’assertions métier. Durée : environ 10 min 45 s, avec `maxWorkers: 1`. |
| `npm run db:check` | **BLOCKED** | `missing_configuration` ; aucun serveur PostgreSQL disponible/configuré. |
| `git diff --check` | **PASS** | Aucun problème de whitespace au moment de la vérification. |

### Défaut prioritaire : exports SQL Supabase absents

Le commit présent est intitulé **`Delete supabase directory`** et l’arbre Git ne contient plus aucun fichier `supabase/`. Pourtant, des tests lisent directement ces chemins et exigent leur égalité avec les schémas versionnés dans `server/` : le fichier de migration de base et les migrations optionnelles numérotées 006 à 022. Les échecs constatés incluent notamment `supabase/optional/008_booking.sql`, `009_marketplace_profiles.sql`, `014_appointment_services.sql`, `021_public_access_enforcement.sql`, `022_publish_profile_text.sql` et le snapshot de migration de base.

La vérification `db:schema:check` ne détecte pas cette suppression car elle compare uniquement `db/schema.sql` et `server/migrations.ts`. La suite échoue ensuite sur les tests de contrat qui s’assurent de l’existence et du contenu des livrables Supabase. En l’état, la CI définie dans `.github/workflows/ci.yml` exécute `npm test` sur PR : son succès n’est pas possible tant que ces ressources manquent.

**Correction recommandée :** rétablir les fichiers SQL versionnés attendus (ou réviser explicitement la stratégie Supabase, les tests et toutes les références documentaires de manière cohérente). Ne pas générer puis appliquer un snapshot global sur une base existante sans sauvegarde/restauration testée. Après réparation, exécuter lint, schema check, test complet et build ; vérifier aussi le comportement des migrations opt-in.

### Avertissements de build / test

- Vite signale un chunk principal minifié d’environ **618 kB**, au-dessus du seuil de 500 kB ; le chunk Dashboard est d’environ 414 kB. Les routes sont lazy-loadées, mais une analyse des dépendances partagées/du split des chunks est utile, notamment autour de Recharts et des modules communs.
- Vite avertit d’un import sans extension dans `src/domain/publicCatalog.ts` lorsque la configuration native est utilisée.
- Vitest est configuré avec un seul worker ; la suite est très lente, surtout les tests PostgreSQL embarqués. Réduire le temps doit venir d’un meilleur setup/partitionnement sûr ou de tests ciblés, pas de la suppression d’assertions transactionnelles.
- La suite émet des avertissements Recharts en conteneur JSDOM et au moins un avertissement React `act(...)` ; ils ne causent pas les 16 échecs actuels, mais méritent nettoyage.

## 8. Risques classés et plan recommandé

### P0 — bloquant la validation de la branche

1. **Rétablir les SQL Supabase disparus** et les contrôles de cohérence associés.
2. **Faire passer la suite complète dans l’environnement CI**, puis vérifier le workflow GitHub réel ; le résultat local antérieur n’est pas une preuve distante.
3. **Mettre à jour les chiffres d’état du README/docs** : plusieurs nombres (333, 373, 742 tests verts) décrivent des validations passées et ne représentent pas le commit actuel.

### P1 — prérequis avant pilote cloud / ventes

4. Fournir la configuration PostgreSQL de test et exécuter `cloud:check` en lecture seule avec les droits correspondant au déploiement.
5. Prouver backup et restauration de la base sur un environnement isolé, puis tester auth, RLS et cycle de vie des migrations opt-in.
6. Recetter les scénarios de caisse et remboursements en HTTPS, concurrence entre connexions/appareils, ACK perdu, reprise, clôture de caisse et état du stock.
7. Terminer l’inventaire des chemins financiers legacy et ne basculer checkout/cutover qu’après rapprochement de tous les postes et files locales.
8. Mettre en place observabilité non sensible (taux d’erreur, migrations, outbox, commandes en attente), alertes et procédure de reprise/incident.

### P2 — amélioration de maintenabilité et de performance

9. Découper progressivement les gros composants métier et `SalonRepositoryHub` en unités testables, sans réécriture globale.
10. Réduire les chunks front et clarifier la stratégie de chargement du Dashboard.
11. Réduire le temps de test avec de la préparation de base réutilisée sans partage d’état métier, et isoler les tests rapides des parcours PostgreSQL lourds.
12. Finaliser le parcours public marketplace, stockage privé réel, limites commerciales et sécurité opérationnelle avant d’en faire une promesse produit.

## 9. Limites de l’analyse

- La base cloud était absente ; aucune donnée réelle n’a été consultée ni modifiée.
- Les tests et PGlite couvrent le code et des schémas embarqués, mais pas le service Supabase/Vercel déployé, les cookies du domaine réel, les sauvegardes, le stockage objet ou les performances sous charge.
- La lecture est large mais pas une revue ligne par ligne de chaque fonction ni un audit légal, comptable, fiscal, de confidentialité ou de conformité locale.
- Le rapport décrit le dépôt tel qu’il a été trouvé sur la branche indiquée. Il n’introduit pas de changement fonctionnel et ne revendique aucun déploiement.

## Verdict

**Projet techniquement ambitieux et bien structuré sur plusieurs aspects métier/sécurité ; validation de la branche courante non verte.** Le défaut établi à corriger en premier est la suppression du dossier `supabase/`, en contradiction avec les tests, la CI et les procédures documentées. Une fois le dépôt cohérent et les 742 tests repassés, les principales portes avant production restent la configuration et la recette cloud, la sauvegarde/restauration démontrée, les essais multi-postes HTTPS et la fermeture contrôlée des anciens flux financiers.
