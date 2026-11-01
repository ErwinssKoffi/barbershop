# 03J — Configuration de la base officielle

1er novembre 2026 — demande utilisateur : « donc configure la alors ».

## Configuration réalisée

- Projet officiel : `pfiuujyybxtpoetdkmbc` (BarberShop).
- URL API non secrète : `https://pfiuujyybxtpoetdkmbc.supabase.co`.
- Schéma privé applicatif : `salon_pro`. Les tables existantes `public` ne sont ni remplacées ni modifiées.
- Identité enregistrée dans `server/officialDatabaseTarget.ts` et variable non secrète documentée dans `.env.example` : `SALON_SUPABASE_PROJECT_REF=pfiuujyybxtpoetdkmbc`.
- Variable **réellement créée et relue** sur Vercel, projet `barbershop`, environnement **production uniquement**. Aucun changement de variable de preview/development : pas de raccordement implicite des previews à la base officielle.

Quand SALON_SUPABASE_PROJECT_REF est définie, le constructeur commun de pool vérifie avant connexion : URI PostgreSQL, projet officiel attendu, hôte direct `db.<référence>.supabase.co`, ou domaine pooler Supabase avec utilisateur suffixé par `.<référence>`. Les connexions vers une autre cible sont refusées. Le pool conserve TLS avec vérification de certificat et `search_path=salon_pro`. Ce garde-fou est une validation de routage de configuration, pas une nouvelle autorisation SQL.

Le verrou de cible est explicite : les tests/restaurations locales isolées ne définissent pas cette variable. Ne pas modifier la constante officielle pour une recette ; employer un environnement de test distinct. Les URI API HTTPS ne peuvent pas servir de connexion PostgreSQL. Aucun identifiant ou secret de connexion n’est codé en dur.

## Secrets et limites vérifiés

La liste des variables Vercel confirme la présence de `SUPABASE_DATABASE_URL` et `SALON_AUTH_SECRET`, sensibles et limitées à production. Aucune décryption, récupération du secret ou remplacement réalisé. Leur existence **ne prouve pas** que leur contenu pointe effectivement vers cette cible ni que l’authentification TLS fonctionne. Le garde-fou vérifiera la cible configurée lors du futur démarrage serveur et refusera une incohérence.

Aucun déploiement effectué : le nouveau code n’est pas encore en service. La variable Vercel sera disponible aux prochains déploiements de production. Aucun `VITE_` ajouté pour exposer une connexion PostgreSQL au navigateur.

La commande locale `npm run db:check` retourne `missing_configuration` : aucune URI privée disponible dans cet environnement. Pour une vérification locale, configurer la connexion PostgreSQL dans l’environnement serveur privé ou `.env.local` ignoré, jamais en chat ni dans les arguments. Aucun faux mot de passe ou URL de connexion fabriquée.

## Migrations et sécurité

Désigner la cible officielle ne sélectionne ni n’applique automatiquement les migrations optionnelles. Aucune migration distante, aucun abonnement, aucune publication ni attribution du rôle opérateur n’a été effectuée dans cette tranche. Les derniers contrôles distants restent ceux de 03I : registre 001–005, 006–021 en attente. Restauration réelle du backup du 1er novembre non vérifiée : les garde-fous restent fermés.

Suite : preuve de restauration isolée, recette des migrations sur la copie, application contrôlée sur salon_pro, puis vérification applicative hébergée. Publication web et No-Go production inchangés.

## Validation

Après réinstallation des dépendances par `npm ci` (outils absents au premier essai), validation complète :

- Lint : 0 erreur, 0 avertissement, 281 fichiers.
- Tests : **700/700, 77 fichiers**, 638,97 s.
- Build : réussi ; avertissement existant 618,04 kB (gzip 183,62 kB).
- Schema check et diff check : réussis.
- Quatre tests ajoutés : identité sans secret, URL API refusée, connexion directe/pooler et schéma/TLS, autres projets/domaines refusés, test isolé sans verrou officiel.
