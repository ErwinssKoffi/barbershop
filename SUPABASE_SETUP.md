# Branchement Supabase — SALON PRO

## État livré (30 octobre 2026)

Le projet Supabase **BarberShop** a reçu la migration `salon_pro_baseline`. Les 19 tables PostgreSQL utilisées par le moteur de gestion sont créées dans **`salon_pro`**, sans données injectées. Le schéma `public` existant (réservations, fidélité, etc.) n’a pas été modifié.

Vérification réelle après migration : 19 tables, RLS activée sur chacune, aucun droit USAGE sur le schéma pour `anon` et `authenticated`.

Cette RLS est une fermeture de l’accès navigateur, **pas encore une isolation multi-tenant du serveur**. Le rôle propriétaire utilisé par l’API contourne la RLS ; FORCE RLS, tenant signé et rôle applicatif restreint seront livrés avec la migration multi-tenant. Ne pas commercialiser cette version comme un SaaS multi-tenant isolé.

## Activer la connexion de l’application

1. Dans Supabase > projet BarberShop > **Connect**, récupérer la connexion PostgreSQL (pooler en mode session recommandé pour les transactions et options de session).
2. Dans le gestionnaire de secrets du déploiement, renseigner **`SUPABASE_DATABASE_URL`**, uniquement côté serveur. En développement, utiliser le fichier `.env` ignoré par Git. Ne jamais transmettre le mot de passe en conversation ni utiliser un préfixe `VITE_`.
3. Renseigner **`SALON_AUTH_SECRET`** avec une clé aléatoire forte, identique sur toutes les instances.
4. Redémarrer/redéployer l’application. `/api/health` doit indiquer `databaseConfigured: true`. Se connecter/créer le premier Gérant via l’application, puis activer la synchronisation Cloud dans Paramètres.
5. Vérifier une saisie et une synchronisation depuis un second appareil avant utilisation opérationnelle.

Si `SUPABASE_DATABASE_URL` est renseignée, elle est prioritaire sur `DATABASE_URL` (compatibilité Neon conservée). Le pool configure `search_path=salon_pro`, **sans repli vers public**. La migration doit donc être appliquée avant la connexion. Les connexions Supabase identifiées par leur hôte utilisent aussi ce schéma quand l’URI est fournie via `DATABASE_URL`.

Aucune URI PostgreSQL ni clé secrète n’est présente dans le dépôt. L’environnement Arena actuel ne contient pas la variable de connexion : le parcours navigateur → API → PostgreSQL Supabase n’a donc pas encore été exécuté de bout en bout. L’accès du connecteur de gestion Supabase ne fournit pas automatiquement les identifiants PostgreSQL au processus Node.

## Chemin des données

Navigateur → routes relatives `/api/auth/*`, `/api/users*`, `/api/sync*` → serveur Node `pg` → Supabase PostgreSQL `salon_pro`.

Les modules financiers existants restent branchés sur ce chemin de synchronisation commun ; il n’y a pas de seconde implémentation des calculs ni d’accès direct `supabase-js` aux tables sensibles.

Les comptes sont créés via `/api/auth/register` ou les routes d’administration, jamais via la synchronisation. `POST /api/users/provision` crée **un compte par appel**, avec un mot de passe haché côté serveur, et refuse un e-mail existant (pas de remplacement de hash/rôle). Il ne transfère pas les hashes des comptes locaux.

## Ce qui reste à intégrer

- Migration organisations/tenants, RLS forcée et rôle serveur restreint.
- Migration contrôlée des données Neon existantes : aucun transfert ni suppression n’a été exécuté.
- Mapping éventuel des tables publiques existantes (réservations/fidélité) avec les identités et tenants SALON PRO. Elles ne sont pas automatiquement reliées au moteur financier.
- Supabase Auth : non activé pour SALON PRO ; l’authentification réelle PBKDF2/HMAC existante est conservée jusqu’à une migration explicite des identités.
- Storage privé pour justificatifs et Realtime si nécessaire ; aucun bucket public ni abonnement à des tables financières n’a été créé.
- UI d’administration Équipe, puis abonnements et paiements réels.

Le fichier `supabase/migrations/20261030000100_salon_pro_baseline.sql` est la version locale reproductible de la migration appliquée. Il ne contient ni seed ni modification des tables `public`.

## Mise à jour sécurité et migrations

La migration distante `salon_pro_auth_security` est appliquée. Elle ajoute `auth_rate_limits` et `schema_migrations` dans le schéma privé ; leur RLS et l’absence de droits de lecture navigateur ont été vérifiées. Le registre reconnaît `001_baseline` et `002_auth_security` pour éviter de rejouer le socle déjà installé.

- Utiliser Node 22.18+ (ou Node 24) pour les scripts TypeScript serveur.
- Lancer `npm run db:migrate` avec une connexion privée disposant des droits DDL, avant le déploiement ; ne pas utiliser une clé API Supabase à la place d’une URI PostgreSQL.
- `SALON_AUTH_SECRET` doit contenir au moins 32 caractères en production. Sans elle, l’API refuse de servir (503) : le repli sur le PIN/secret mémoire n’existe plus en production.
- `npm run db:schema` génère le snapshot SQL ; `npm run db:schema:check` vérifie sa parité en CI.
- Les scripts d’administration et l’accès direct SQL ne sont pas un moyen d’authentification pour le navigateur. Supabase Auth/Storage/Realtime restent des étapes distinctes.

## Mise à jour multi-tenant (étape 4)

La migration `salon_pro_tenancy` est appliquée au schéma privé. Elle remplace la simple fermeture initiale par des policies d’isolation sur les **18 tables métier, RLS forcée**. Les 19 tables historiques portent `tenant_id` (les identités `salon_users` restent hors RLS métier, avec accès d’administration filtrés explicitement).

Les transactions applicatives changent de rôle vers un rôle runtime créé par la migration, NOLOGIN/NOSUPERUSER/NOBYPASSRLS, puis posent `app.tenant_id` avec portée transactionnelle. Le contrôle distant a confirmé le rôle réduit et l’absence de recette visible sans contexte. Les tables publiques préexistantes ne sont toujours pas reliées au moteur financier.

**Déploiement coordonné requis :** cette migration change les clés de conflit. Déployer le serveur compatible avec `003_tenancy` en même temps que la migration ; ne pas réutiliser un ancien serveur qui fait `ON CONFLICT (id)`.

Le rôle exécutant `npm run db:migrate` doit disposer des droits DDL et de création/attribution du rôle runtime. Le rôle de connexion doit pouvoir `SET ROLE` vers ce runtime. Les transactions métier ne continuent pas en mode privilégié si cette réduction échoue. Une connexion runtime séparée du compte de migration reste recommandée pour le déploiement ; elle nécessitera la séparation du lancement des migrations automatiques.

Le premier compte utilise le salon hérité créé structurellement en base. L’onboarding d’autres organisations et le sélecteur multi-salon sont encore à construire. En attendant, un poste local ne se rattache qu’à un seul salon et refuse un changement qui mélangerait ses données. Reconnecter les utilisateurs après déploiement pour obtenir un jeton contenant `tid` et rattacher le poste.

## Mise à jour sessions (étape 5)

La migration distante `salon_pro_sessions` est appliquée (`004_sessions`). La table privée conserve les hashes des refresh et la révocation. L’absence de droits de lecture pour anon/authenticated a été vérifiée ; elle n’est pas exposée à la Data API. Comme les identités, cette table globale d’authentification est consultée avant le contexte métier, via des requêtes serveur explicites.

Déployer le serveur et reconnecter les utilisateurs : les accès historiques sans session en base sont refusés. Les nouveaux accès durent 15 minutes, renouvelés par un cookie HttpOnly/SameSite=Strict/Secure en production. Utiliser l’application en HTTPS sur son origine propre pour valider les cookies ; un iframe tiers ou le blocage navigateur des cookies peut empêcher le renouvellement.

Le refresh n’est pas retourné dans le JSON. Les appels passent par les routes relatives de l’application, pas par Supabase Auth : l’authentification maison durcie est conservée pour ce lot. La rotation est stricte à usage unique ; une course inter-onglets sans Web Locks ou une réponse perdue peut nécessiter une reconnexion. Prévoir une purge planifiée des sessions expirées et des tests E2E HTTPS avant mise en production.

## Mise à jour synchronisation par révisions (étape 6)

La migration distante `salon_pro_sync_revisions` est appliquée (`005_sync_revisions`). Version reproductible : `supabase/migrations/20261030000500_sync_revisions.sql`. Elle crée `salon_pro.sync_state` et `salon_pro.sync_changes`, leurs policies FORCE RLS, un index par ligne, 17 triggers et la baseline des données existantes. Contrôles distants : registre 001–005, aucun droit SELECT anon/authenticated, droit INSERT runtime. Les tables publiques préexistantes ne sont pas modifiées.

Déployer le serveur compatible et le nouveau client ensemble ; recharger les onglets restés sur l’ancienne version. La synchronisation conserve le premier instantané, puis utilise un curseur par salon et des pages de 500 révisions maximum. Ne pas purger le journal ni modifier son compteur à la main : aucun protocole de réinitialisation après rétention n’est encore implémenté. Planifier la croissance du journal et des tombstones ; la remise à zéro d’une base distante n’est pas compatible avec un ancien curseur local sans procédure explicite.

Le rôle Supabase `authenticated` n’accède toujours pas directement aux finances : toutes les requêtes passent par l’API applicative et le rôle runtime transactionnel. Les permissions Gérant/Caissier sont appliquées côté serveur par entité ; Supabase Auth n’est pas utilisé pour remplacer l’authentification existante.

Les conflits ne sont plus tranchés par les dates des appareils : les écritures obsolètes sont refusées par ligne, les autres peuvent être acceptées. Consulter `rejected` même sur une réponse 200. Le client conserve les versions locales écartées dans son journal JSON exportable depuis les paramètres Cloud. Pas encore d’interface de fusion ni de rétention de ce journal.

**Limite poste partagé :** l’IndexedDB actuelle est liée au salon, pas partitionnée par rôle. Le filtrage API ne retire pas des données de Gérant déjà cachées dans ce même profil. Utiliser un profil navigateur séparé pour un poste Caissier. Les projections publiques employé/réglages et le changement de visibilité après promotion restent à terminer avant un parcours Caissier complet.

Le connecteur d’administration confirme l’application du schéma mais ne fournit pas la connexion serveur privée. Configurer `SUPABASE_DATABASE_URL` (ou `DATABASE_URL`) et `SALON_AUTH_SECRET` dans l’environnement sécurisé d’hébergement, puis valider l’application déployée en HTTPS. Ne jamais placer une URI PostgreSQL ou une clé privilégiée dans les variables `VITE_*`.

## Mise à jour des caches locaux et projections (étape 8)

Cette étape ne nécessite aucune nouvelle migration SQL : le schéma privé reste en 001–005. Les projections sont effectuées par le serveur applicatif, pas par un accès direct aux tables Supabase. Déployer serveur et client ensemble afin de transmettre au Caissier l’annuaire employé sans rémunération/note et les réglages publics de reçu, sur les instantanés comme sur les deltas et refus.

Les caches locaux sont désormais distincts par salon, compte et rôle ; les anciens curseurs ne sont pas partagés entre ces espaces. Fermer les anciennes fenêtres avant le déploiement. La base historique est conservée et peut être reprise une fois par un Gérant identifié ; un Caissier ne l’adopte pas. Le passage d’un compte local vers une identité Cloud de même e-mail/rôle conserve un lien de reprise de son ancien espace personnel. Les autres fusions d’identités nécessitent une procédure explicite.

Cette partition ne chiffre pas IndexedDB et ne protège pas contre une personne contrôlant le même profil navigateur, les outils développeur ou un script compromis de la même origine. Les profils OS/navigateur séparés restent nécessaires pour une confidentialité forte. Un nouveau compte nécessite une première synchronisation pour voir les données partagées ; la base d’un autre compte n’est pas automatiquement réutilisée.

Le parcours Cloud de caisse/stock demande encore une commande serveur atomique et idempotente : ne pas considérer l’ajout d’un mouvement de stock et la mise à jour locale de quantité comme une transaction distribuée validée. Les droits de modification du catalogue restent réservés au Gérant. La prochaine étape traite ces effets métier côté serveur, sans rendre les produits arbitrairement modifiables par le Caissier.

## Stock dérivé Caissier (étape 9)

Aucune migration supplémentaire : les tables privées et le journal 001–005 sont réutilisés. Le serveur applicatif calcule maintenant les sorties liées aux recettes du Caissier sous le verrou du salon et dans la même transaction que les produits/mouvements/recettes. Le stock et le coût du produit en base font autorité ; le catalogue n’est pas rendu modifiable par le Caissier.

Déployer serveur et client ensemble pour que Dexie reconnaisse les champs de mouvement normalisés. Conserver les mêmes identifiants lors des reprises : ils empêchent le double débit. Un manque de stock ou un lien recette–mouvement invalide renvoie 409 et annule **tout** l’envoi, pas seulement le ticket concerné. Examiner les opérations locales avant de recréer des identifiants.

Le parcours Caissier exige une recette concordante pour chaque vente/consommation ; achats, ajustements, pertes et retours positifs ne passent pas par ce chemin. Une correction d’un mouvement déjà accepté nécessite un workflow Gérant, pas une modification/recréation silencieuse de l’événement.

Ce renforcement ne remplace pas encore une commande d’encaissement complète : prix, variantes, total payé, splits, caisse et numérotation doivent encore être validés/recalculés côté serveur. Le chemin Gérant de synchronisation stock reste distinct. Valider les courses multi-connexions et le parcours HTTPS sur l’hébergement réellement relié à Supabase ; les tests PostgreSQL embarqués ne constituent pas cette recette.
