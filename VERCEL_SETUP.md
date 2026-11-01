# Vercel — projet barbershop

## Configuration effectuée le 31 octobre 2026

Projet créé puis relu via le connecteur dans l'équipe `durandobi634-8314s-projects` :

- Projet : `barbershop` (`prj_yJHyZwDdtFVRukzlPaTWtw2jIPkb`).
- Framework : Vite ; installation `npm ci` ; build `npm run build` ; sortie `dist` ; racine du projet.
- Variables déjà créées pour development, preview et production : `VITE_SERVER_CHECKOUT=false`, `SALON_CHECKOUT_SYNC_MODE=legacy`, `SALON_CHECKOUT_CUTOVER_APPROVED=false`.
- Aucun dépôt Git lié et aucun déploiement créé : pas de déploiement automatique de `main`, pas de modification des autres projets Vercel.
- Liaison CLI locale dans `.vercel/project.json`, dossier ignoré par Git.

Le dépôt déclare également ces paramètres dans `vercel.json`, avec la région des fonctions `dub1` (Dublin). `package.json` et le lockfile imposent Node `22.x`, version majeure utilisée par les validations locales. Ces paramètres Node/région seront pris en compte lors du déploiement de **ces fichiers** ; les valeurs par défaut du projet Vercel relu sont encore Node 26 et iad1, puisqu'aucun déploiement n'a eu lieu.

Le routage `/api/*` vers la fonction Node, le repli SPA et les en-têtes de sécurité existants sont conservés. Aucune migration n'est incluse dans le build.

## À renseigner en privé avant tout déploiement fonctionnel

[Variables d'environnement du projet](https://vercel.com/durandobi634-8314s-projects/barbershop/settings/environment-variables)

1. `SUPABASE_DATABASE_URL` : URI PostgreSQL du projet Supabase BarberShop, obtenue dans Supabase → Connect, pooler session recommandé. Ne pas utiliser une clé anon/service-role à la place d'une URI PostgreSQL. Aucun secret de base n'a été obtenu ou inventé pendant cette configuration.
2. `SALON_AUTH_SECRET` : valeur cryptographiquement aléatoire d'au moins 32 caractères, stable par environnement. Utiliser des valeurs distinctes pour preview et production ; ne jamais les versionner, exposer avec un préfixe VITE_ ou les transmettre en conversation.

Ces deux variables **ne sont pas encore créées dans Vercel**. Préférer le type Sensitive pour preview/production. Si une préversion se connecte à une base réelle, elle doit utiliser un environnement isolé de recette, pas modifier les données de production pour faire une démonstration.

## Publication et recette restant à réaliser

Le lot initial a été publié et fusionné dans main via la PR #3. Le lot de recette Cloud du 1er novembre est développé séparément sur `arena/d9068337-barbershop` et n’est pas encore publié. La fusion Git ne constitue pas un déploiement ni une recette Cloud. Avant une préversion, faire valider et publier la référence concernée et l’utiliser explicitement ; ne pas déployer automatiquement main en production.

Après configuration privée et déploiement explicite : vérifier `/api/health`, puis une véritable connexion/authentification PostgreSQL et les routes `/api` sous HTTPS. `databaseConfigured:true` seul ne prouve pas que PostgreSQL répond. Les migrations 001–005 ont été vérifiées sur Supabase ; 006/007 restent volontaires/non appliquées, et les pilotes restent désactivés. Aucun Go de production, backup/restore ou recette multi-poste n'est acquis par la création du projet.

## Résultats de validation locale

- `npm ci` : réussi, audit zéro vulnérabilité.
- Lint, build, schema check et diff check : réussis.
- Tests ciblés Vercel/sécurité : **7/7** réussis.
- Suite complète après reprise : **338/338**, **43 fichiers**, 383,38 s (`.cache-vercel-resume-full-tests.log`). Build séparément consigné dans `.cache-vercel-resume-build.log`.
- Le précédent passage 328/335 avait sept timeouts de cinq secondes. Limitation à un worker pour limiter la contention PGlite/WASM et hachage sur petits runners. Trois vérifications de migrations absentes ont été séparées des scénarios droits/isolation qui initialisaient deux bases : chaque test conserve sa base isolée, toutes les assertions sont conservées et le délai de cinq secondes reste inchangé. Le premier passage ciblé avec un seul worker avait encore deux timeouts ; la séparation des scénarios était également nécessaire.

Le déploiement et la connexion Cloud restent **non testés**, et la porte de production demeure No-Go.

## Reprise du 1er novembre 2026

Variables relues : les deux secrets privés restent absents ; aucune activation effectuée.
`cloud:check` et le protocole de [recette](docs/RECETTE_CLOUD_FINANCIERE.md) sont maintenant disponibles.
Dernière suite locale après le lot de rapprochement : **373/373 tests, 47 fichiers** (359,02 s), lint/build/schema/diff réussis. Le résultat 355/355 correspond au lot précédent.
Cette validation locale ne remplace pas la recette hébergée ; aucun Go de production.

## État connu après ajout privé des variables et lot booking

Lors de la vérification consécutive à la confirmation de l’utilisateur, les variables
SUPABASE_DATABASE_URL et SALON_AUTH_SECRET étaient présentes comme Sensitive **Production
uniquement**, sans déchiffrement ; aucun déploiement n’existait. Les mentions d’absence
ci-dessus décrivent les vérifications antérieures. Preview et le workspace local ne
reçoivent pas automatiquement ces variables. Aucune connexion Node → Supabase prouvée.

Le lot booking ajoute une migration **008 volontaire** et les flags serveur/UI désactivés
par défaut ; ne pas activer les flags pour une démonstration avant la recette isolée.
Voir [BOOKING.md](docs/BOOKING.md). Dernière validation locale : **402/402 tests, 50 fichiers**,
379,65 s, lint/build/schema/diff réussis. Aucun déploiement ou schéma hébergé modifié.
