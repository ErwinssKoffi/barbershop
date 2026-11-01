# ADR-001 — Portail React/Vite, homogénéité de stack et rendu public

- Date : 2026-11-01 ; révisé sur instruction explicite de l’utilisateur.
- Statut : **VITE ACTÉ PAR L’UTILISATEUR ; séparation/SSR/déploiement proposés, à valider avant code**.
- Portée : PROMPT 01, documentation uniquement.
- Remplace : recommandation initiale Next.js, non implémentée.
- Liens : [architecture](../01_TARGET_ARCHITECTURE.md), [audit](../00_REPOSITORY_AUDIT.md), [origines](ADR-006_DOMAINS_COOKIES.md).

## Contexte et décision utilisateur

L’ERP est React/TypeScript/Vite avec API Node, scripts npm, sortie `dist` et SW de scope `/`. L’utilisateur demande de **rester sur Vite pour homogénéiser la stack**. Aucun Next.js n’a été installé ; il ne sera pas introduit. Cette décision prévaut sur la préférence technique initiale du PROMPT 01 ; le playbook demandait une comparaison, pas l’emploi obligatoire de Next.js.

Les fiches salon nécessitent HTML et métadonnées indexables sans session et sans JavaScript. Vite est un outil de build/dev, pas à lui seul un framework SSR ou une garantie SEO. Le rendu serveur doit donc être conçu explicitement en React/Node.

## Options comparées

1. **Next.js séparé**, proposition initiale écartée : SEO serveur intégré, mais framework/conventions/build supplémentaires contraires au choix d’homogénéité.
2. **Public dans la SPA ERP actuelle** : un package et un build, mais SEO serveur non acquis ; refonte routeur/contextes/SW avec risque sur `/`, `/cash`, `/booking`, sessions et cache privé.
3. **Portail React/Vite séparé avec SSR Node**, recommandé : mêmes technologies, mêmes pratiques npm/TypeScript/tests ; routes, contexte public et builds séparés pour préserver l’ERP. Deux déploiements et responsabilité du rendu/hydratation à maintenir.
4. **Portail Vite statique prérendu** : utile pour landing fixe, mais génération/invalidation insuffisantes à elles seules pour profils dynamiques, dépublication et réservation.

## Cible proposée

Option 3 dans `marketplace/`, **phase 04 seulement**, sans migrer l’ERP vers SSR. La séparation des applications est une proposition de sécurité/maintenance, pas une conséquence obligatoire de l’outil Vite. Pas de nouveau framework SSR imposé dans cette ADR.

Sous-projet avec son package/lockfile et configurations Vite/TypeScript/tests ; versions alignées avec celles supportées par l’ERP sans upgrade forcé. Pas de conversion immédiate en workspace ni de changement des commandes root. Les builds root continuent de produire l’ERP dans `dist`.

Portail : template HTML, entrées client/serveur React, routeur public indépendant, manifeste d’assets, sorties client et serveur séparées. L’adaptateur Node charge les DTO publics puis rend HTML/head et données publiques échappées ; le client hydrate la même vue. Le bundle SSR n’est jamais exposé comme asset. Aucun import Dexie/auth privée/secret/driver SQL dans le bundle navigateur.

En dev, serveur Node avec Vite middleware SSR ; en production, bundle serveur compilé et assets client. **`vite preview` et un preset de déploiement Vite purement statique ne fournissent pas cette cible SSR.** Un adaptateur HTTP/serverless avec routage, manifeste et headers est requis et doit être testé sur l’hébergement cible. Aucun serveur de production ne dépend du dev server.

Projet de déploiement séparé proposé, sans changement du projet ERP. Préserver chemins profonds et SW ERP sur son origine, pas de SW dans le portail au MVP. Proxy public borné pour API/médias côté Node ou reverse proxy, cohérent avec le dev ; ne pas confondre `server.proxy` Vite et routage production.

## SEO, sécurité et cache

Rendu initial par URL : contenu publié, titre/description, canonical, OG, robots/noindex et JSON-LD ; vrais statuts HTTP 404 pour profils non visibles. Échapper contenu HTML, attributs et JSON injecté, sans `dangerouslySetInnerHTML` non contrôlé. Aucun état utilisateur dans un singleton SSR ; aucun identifiant privé/capacité client dans l’HTML.

SSR/fetch `no-store` au MVP, pas de cache de fiches ni de CDN HTML pouvant laisser un profil dépublié accessible. Prérendu possible pour pages fixes sans données sensibles, pas comme substitut au gate des fiches. Même backend public et DTO versionnés pour SSR et navigation cliente ; aucune requête directe aux tables métier.

## Compromis et critères de validation

- Homogénéité React/Vite/TypeScript/Node, mais travail explicite sur SSR, hydratation, routing, CSP et adapter de déploiement ; aucun bénéfice SEO automatique annoncé.
- Deux builds à maintenir ; coûts SSR/egress et budgets latence à mesurer, pas de tarif supposé.
- CI existante conservée ; ajouter job portail lint/tests/build client+serveur, contrats API et tests HTTP HTML initial sans JS, statuts, métadonnées et protection contre injection.
- Tests d’hydratation/navigation, erreurs SSR, absence de fuite inter-requêtes, dépublication immédiate, proxy sans cookies ERP et cache/SW isolés.
- Avant code portail : valider séparation/SSR et contrat de déploiement. Avant distant : origines exactes, environnement recette isolé et preuves d’exploitation.

**Aucun package, serveur SSR, route ou projet distant créé ici. Le choix Vite est enregistré ; les autres ADR et la porte avant migrations restent à valider.**
