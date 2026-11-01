# PROMPT 01 — Validation et porte d’architecture

Date : 1er novembre 2026. Branche : `arena/1bd00d86-barbershop`. HEAD de départ : `e191a1d9235471bc937c6a2ca21a4060020d721f`.

## Périmètre

Ajouts de ce lot : [architecture cible](01_TARGET_ARCHITECTURE.md), six [ADR](adr/ADR-001_PUBLIC_PORTAL.md) (001 à 006) et ce compte rendu. Les deux rapports 00 préexistants sont conservés. Aucun module, manifeste, lockfile, schéma, migration, route, configuration, variable, donnée ou environnement distant modifié. Aucun commit/push ni déploiement.

## Correspondance avec PROMPT 01

| Exigence du playbook | Livraison |
|---|---|
| Comparaison Next séparé / Vite existant et impacts | Architecture §2 et ADR-001 ; décision utilisateur ultérieure : React/Vite, sans Next.js |
| Introduction sans casser les builds/root | §2 : sous-projet/lockfile/CI/déploiement indépendants ; pas de workspace imposé |
| Domaines fonctionnels | §4 : directory, profil/média, scheduling, appointments, SaaS/droits, promotions, analytics, notifications/control plane |
| Frontières et DTO | §3–5, ADR-002/006 ; aucune sérialisation de payload privé |
| Slug cross-tenant sécurisé | §6, ADR-002 : projection/gate/role limité, double vérification avant écriture |
| Upload/publication/lecture/booking/conversion | Diagrammes Mermaid §3/6/7/8, flux texte et atomicité checkout |
| Rôles Gérant/Caissier/admin | §9, ADR-005 : admin distinct sans droit métier implicite |
| Flags/rollback | §10 : flags serveur off, suivi des RDV et invariants financiers conservés |
| Six ADR | `adr/ADR-001_PUBLIC_PORTAL.md` à `ADR-006_DOMAINS_COOKIES.md`, statuts proposés explicites |
| Diagrammes et architecture documentés | Quatre diagrammes Mermaid dans le document principal ; pas de diagramme présentant un système déjà déployé |

## Contrôles techniques du lot

Passage initial avant révision vers Vite, terminé à **07:33:47 UTC** :

| Contrôle | Code | Résultat |
|---|---:|---|
| `npm run db:schema:check` | 0 | Snapshot existant cohérent ; aucun DDL ni changement de schéma |
| `npm run lint` | 0 | 213 fichiers, **0 erreur / 0 warning** |
| `npm test` | 0 | **402/402 tests, 50 fichiers**, début 07:28:25 UTC, **319,40 s** |
| `npm run build` | 0 | TypeScript + Vite réussis ; build Vite 927 ms hors compilation TypeScript |
| `git diff --check` | 0 | Aucun diff suivi en erreur |
| Contrôle documentaire explicite | 0 | Huit nouveaux documents, liens relatifs existants, fin de fichier et espaces, blocs de code équilibrés ; six ADR et quatre blocs Mermaid présents |

Avertissement build inchangé : bundle principal **613,89 kB** minifié / **182,40 kB gzip**, seuil 500 kB dépassé. Non masqué, non bloquant pour ce lot documentaire. Aucun score performance/accessibilité mesuré. Les diagrammes ont été relus textuellement et leurs blocs contrôlés ; pas de rendu Mermaid automatisé ni de validation navigateur prétendue.

Logs temporaires non versionnés : `.cache/marketplace-architecture/{schema,lint,tests,build}.log` ; résultats essentiels conservés ici. `git status --short` : uniquement `?? docs/marketplace/`, qui comprend les deux rapports 00 déjà présents et les huit documents de ce lot ; aucun fichier suivi existant modifié. Le contrôle documentaire explicite couvre les nouveaux fichiers que `git diff --check` ne voit pas encore.

Pas de nouveau `db:check` ni d’accès distant : le `missing_configuration` constaté en phase 00 reste une preuve précédente, **pas un nouveau résultat de ce lot**. Les tests vérifient la non-régression de l’existant, pas l’implémentation des ADR proposées.

## Révision utilisateur — homogénéité React/Vite

Instruction explicite : conserver Vite pour toute la stack front, sans Next.js. Architecture §2, diagramme principal, ADR-001 et dépendances média/proxy des ADR-003/006 mis à jour. L’option Next.js reste uniquement dans la comparaison et l’historique, pas dans la cible. Audit/baseline 00 et cahier des charges original conservés comme références historiques, sans réécriture.

Le portail React/Vite séparé avec SSR Node est une **proposition** pour concilier cette décision, SEO et isolation ERP/PWA. Rendu SSR/hydratation et adaptateur de production décrits explicitement ; pas de prétention que Vite seul, `vite preview` ou un preset statique assure le SSR. Aucune dépendance ou application créée.

Validation fraîche après révision, terminée à **07:42:26 UTC** : schéma **0**, lint **0** (0 erreur/avertissement), tests **0** (**402/402, 50 fichiers, 308,26 s**, début 07:37:15 UTC), build **0**, diff check **0**. Avertissement de bundle inchangé (613,89 kB minifié, 182,40 kB gzip). Logs temporaires : `.cache/marketplace-vite-revision/{schema,lint,tests,build}.log`. Ces tests prouvent la non-régression de l’ERP existant, pas un portail SSR encore non implémenté.

## Porte avant code

**Non franchie automatiquement.** Le choix React/Vite sans Next.js est acté par l’utilisateur ; séparation et SSR restent proposés. Validation requise des détails techniques : application distincte/SSR/déploiement, projection publique/RLS, stockage privé, évolution de 008 et exclusion SQL, autorité des droits, origines/proxy/cookies. Fournisseurs, limites, règles métier et décisions commerciales restent ouverts explicitement. La phase 02 sera uniquement locale/additive, après cette validation ; le DDL distant restera bloqué sans restauration prouvée.

Connexion cloud locale et recette hébergée non établies : aucune tentative d’activation ou changement distant pour contourner ces blocages. Les diagrammes ne constituent pas une recette fonctionnelle. **PROMPT 02 non commencé ; No-Go production maintenu.**

**PARTIAL — architecture proposée livrée, acceptation des décisions encore requise.**
