# Suivi d’implémentation SaaS

Date : 30 octobre 2026. Ce suivi décrit uniquement les changements vérifiés dans ce dépôt ; les sprints annoncés dans l’audit fourni ne sont pas considérés comme déjà livrés.

## Étape 1 — Fermeture de la synchronisation des comptes (livrée)

- L’enveloppe Cloud ne lit ni ne transmet les comptes IndexedDB.
- Le serveur ignore les comptes présents dans un ancien payload ou un payload forgé : aucune écriture de `salon_users` depuis le moteur de synchronisation.
- Les réponses push et pull ne contiennent plus `users` ni leurs hashes.
- La fusion locale ignore également `users`, même si un ancien serveur en renvoie.
- Les comptes existants sont préservés, ainsi que le format de sauvegarde/import manuel. Cette étape ne sécurise pas encore la restauration manuelle ni toute l’administration.
- Test de régression : tentative de changement de rôle/hash avec date future, préservation du compte serveur et local, absence de hashes dans les échanges.
- CI ajoutée : lint, tests et build sur les pull requests et les push sur main. La protection obligatoire de branche doit être configurée dans GitHub ; le fichier seul ne bloque pas les merges.

Validation réelle : `npm run lint && npm test && npm run build` réussie ; 50 tests sur 11 fichiers. Avertissements non bloquants : graphiques sans dimensions dans jsdom, navigation jsdom non implémentée et bundle > 500 kB.

**Limite de compatibilité volontaire :** les comptes créés uniquement hors ligne ne sont plus provisionnés implicitement dans PostgreSQL. Les routes explicites sécurisées de provisionnement restent à construire. L’inscription et la connexion Cloud existantes restent disponibles.

## Suite ordonnée

1. Terminer P0-1 : routes dédiées de liste, création/provisionnement et modification des comptes ; rôle du demandeur vérifié en base ; protection du dernier Gérant ; tests API (401/403).
2. P0-5 : secret de production obligatoire, limitation des tentatives, politique de mots de passe et en-têtes de sécurité.
3. P0-4 puis P0-2 : migrations versionnées, organisations, tenants, memberships et RLS ; tests PostgreSQL réels avant production.
4. P0-3 : sessions révocables, refresh rotatif et autorisation par entité.
5. P0-6 : synchronisation delta serveur-autoritaire, pagination et conflits explicites.
6. P0-7 : PWA et rechargement hors ligne.
7. Abonnements, quotas, équipe, isolation locale par salon, portail éditeur et sauvegardes automatiques.
8. PSP réel (sans paiement simulé), puis CRM, agenda, notifications et phases métier suivantes.

Aucune isolation multi-tenant, révocation de session, facturation ni intégration PSP n’est revendiquée à cette étape.

## Étape 2 — Administration des comptes et socle Supabase (livrée)

- `GET /api/users` : comptes publics, jamais les hashes.
- `POST /api/users` et `/api/users/provision` : création seule d’un compte par appel ; hachage serveur, rejet des hashes entrants et doublons ; aucun jeton du nouveau compte renvoyé à l’administrateur.
- `PATCH /api/users/:id` : rôle, activation, mot de passe ; validation stricte des champs, protection contre sa propre désactivation et contre le retrait du dernier Gérant. Verrou PostgreSQL transactionnel pour sérialiser les rétrogradations.
- Vérification du Gérant actif en base à chaque appel d’administration ; l’inscription vérifie aussi la réalité du rôle plutôt que le seul claim signé.
- Journaux structurés de création/modification, sans mot de passe. Persistance d’audit et révocation globale des sessions encore à faire.
- Supabase : migration réellement appliquée au projet BarberShop, schéma privé `salon_pro`, 19 tables avec RLS activée et droits navigateur révoqués. Aucune modification des tables publiques préexistantes.
- Configuration serveur `SUPABASE_DATABASE_URL`, prioritaire sur Neon, avec `search_path` privé. Guide et limites : `SUPABASE_SETUP.md`.
- Aucune connexion PostgreSQL secrète disponible dans l’environnement d’exécution : le schéma distant est vérifié, mais le parcours applicatif complet attend la configuration privée du déploiement. Auth/Storage/Realtime et multi-tenant ne sont pas revendiqués comme intégrés.

Validation : lint 0 erreur/avertissement, **55/55 tests** (12 fichiers), build réussi. Nouveaux tests API : accès anonyme/Caissier, création seule, dernier Gérant, rétrogradation immédiate, modification de mot de passe et rejet des hashes. Tests de configuration Neon/Supabase et de fermeture de la migration.

Prochain lot : durcissement auth (P0-5), migrations versionnées et isolation multi-tenant, puis sessions révocables.

## Étape 3 — Authentification durcie et migrations versionnées (livrée)

### Sécurité

- En production, `SALON_AUTH_SECRET` est obligatoire (au moins 32 caractères) : réponse 503 `AUTH_SECRET_MISSING`, y compris sur la santé, plutôt qu’une signature avec un secret éphémère. Le PIN partagé n’est plus utilisé comme clé HMAC. Les sessions antérieurement signées avec le PIN doivent être renouvelées par une connexion.
- Limitation persistante PostgreSQL : 5 essais/identifiant et 30/IP sur 15 minutes ; 10 inscriptions/IP/heure ; 60 opérations d’administration/acteur sur 15 minutes. Réponse 429 avec `Retry-After` ; remise à zéro du compteur identité après succès, jamais du compteur IP. Les compteurs sont atomiques et communs aux instances, pas en mémoire Node.
- L’identité du compteur est normalisée puis hachée. Le compteur par IP couvre les variantes d’identifiants (nom/téléphone/e-mail) ; une limitation globale par compte après résolution et le 2FA restent à construire.
- Politique commune aux nouvelles inscriptions serveur/locales et aux réinitialisations : 8 à 256 caractères, une lettre et un chiffre. Connexion aux anciens mots de passe toujours autorisée. Parsing des hashes borné (sel/hash attendus, plafond d’itérations) côté Node et WebCrypto.
- CSP, HSTS, DENY, nosniff, Referrer-Policy et Permissions-Policy pour le déploiement Vercel ; nosniff sur les réponses API. Les erreurs SQL inattendues ne sont plus renvoyées au navigateur.
- Correction d’un flux asynchrone de rafraîchissement qui pouvait mettre à jour des composants démontés, détecté pendant la validation des tests.

### Migrations

- Registre `schema_migrations`, migrations `001_baseline` et `002_auth_security` ; verrou PostgreSQL transactionnel par schéma, exécution sur un client unique, rollback de la série entière sur erreur. Le cache d’initialisation n’est marqué qu’après réussite.
- `npm run db:migrate` : exécution explicite. Environnement sans connexion : échec explicite, sans divulgation d’URI. Ce cas a été vérifié localement.
- `db/schema.sql` désormais généré depuis les migrations : `npm run db:schema` et contrôle de parité `npm run db:schema:check` ajouté en CI. Le schéma IndexedDB reste volontairement distinct.
- Migration Supabase `salon_pro_auth_security` réellement appliquée : compteurs et registre dans `salon_pro`, RLS activée et droits de lecture anon/authenticated absents, vérifiés sur la base distante. Aucun changement des tables publiques ni insertion de données métier.

Validation réelle : `npm run db:schema:check && npm run lint && npm test && npm run build` réussie. **68/68 tests, 14 fichiers**. Tests d’idempotence, verrou de migration, rollback et reprise, limites IP/identité, expiration et remise à zéro, configuration de production, politique locale et compatibilité des anciens comptes. Avertissements non bloquants existants : dimensions des graphiques jsdom et taille du bundle.

### Limites et suite

- Les sessions restent des jetons signés de 30 jours non révocables : le chantier sessions/refresh reste indispensable. Ce lot ne clôture donc pas toute la sécurité P0.
- Purge périodique des compteurs expirés à planifier (`auth_rate_limits.expires_at` est indexé).
- Derrière Vercel, l’IP est issue du X-Forwarded-For remplacé par la plateforme. Hors Vercel, seule l’adresse socket est utilisée : un autre reverse-proxy nécessite une configuration d’IP de confiance avant production.
- La connexion secrète PostgreSQL n’est toujours pas fournie au serveur de l’environnement Arena : pas de validation applicative de bout en bout contre Supabase.
- Prochaine étape : `organizations`/`tenants`/`memberships`, contexte transactionnel signé et FORCE RLS, puis sessions révocables. Le multi-tenant et les abonnements ne sont pas revendiqués comme terminés.

## Étape 4 — Isolation multi-tenant serveur (livrée)

### Modèle et migration

- Migration versionnée `003_tenancy` : organisations, salons, appartenances et un rattachement structurel du salon hérité (`tenant_bootstrap`). Aucun catalogue, faux compte ni identité fictive injecté ; les noms restent vierges ou reprennent le nom réel existant.
- `tenant_id` obligatoire sur les 19 tables historiques. Données existantes rattachées au salon hérité sans suppression ni changement des payloads d’origine ; comptes existants backfillés dans `memberships`.
- Clés primaires `(tenant_id, id)` sur les tables métier, et `(tenant_id, entity_type, entity_id)` pour les tombstones. Tous les `ON CONFLICT` du moteur de sync suivent ces clés : des identifiants identiques entre salons ne se heurtent plus.
- RLS activée ET forcée sur les 18 tables métier, avec policies `USING` et `WITH CHECK`. Contexte absent/vide : aucune ligne visible sous le rôle applicatif.
- Rôle runtime NOLOGIN/NOSUPERUSER/NOBYPASSRLS distinct du propriétaire, nommé par schéma. Les transactions métier passent explicitement sous ce rôle, même avec une connexion Supabase privilégiée ; retour au rôle/contexte initial au COMMIT/ROLLBACK.

### Serveur et comptes

- Les nouveaux jetons portent `tid`. L’appartenance, le rôle courant et l’activation du salon/compte sont relus en base à chaque requête authentifiée.
- Les anciens jetons sans `tid` sont résolus depuis le salon d’origine du compte, jamais depuis le navigateur. Un `tid` signé mais non autorisé est refusé.
- Le salon de synchronisation provient uniquement de la session résolue. Le canal PIN machine reste limité au salon hérité défini en base ; aucun salon du corps de requête n’est utilisé.
- Push, pull, purge de mocks à la connexion/inscription et vérification Cloud sont transactionnels et contextualisés. Les tombstones restent persistants et isolés.
- Les comptes sont des identités globales (e-mail unique conservé). L’administration liste les appartenances du salon et modifie les rôles/activations dans `memberships`, sans désactiver une identité dans tous les autres salons. Changement de mot de passe d’une identité externe au salon refusé.
- `salon_users` et les métadonnées d’accès restent hors RLS métier pour l’authentification globale. Leurs accès d’administration sont explicitement filtrés ; aucun droit navigateur n’est ajouté. Le PIN ne permet plus de créer des comptes.

### Garde-fou local

- Dexie v5 ajoute une métadonnée locale persistante de rattachement au salon, distincte des payloads synchronisés. Elle est conservée lors d’un import et d’une réinitialisation locale.
- Un poste rattaché refuse le cache/connexion d’un autre salon et la synchronisation avec un token d’un autre salon. Les sessions navigateur historiques doivent se reconnecter pour rattacher le poste.
- **Ce n’est pas encore une base IndexedDB par salon ni un sélecteur multi-salon.** Un autre profil navigateur est nécessaire pour utiliser un autre salon sur le même poste ; aucune donnée n’est purgée silencieusement. La première association d’un poste hérité reste une adoption de ses données locales par le compte correspondant.

### Supabase et validation

- Migration `salon_pro_tenancy` réellement appliquée au schéma privé `salon_pro` du projet BarberShop, sans toucher aux tables publiques préexistantes.
- Vérification distante : 3 migrations enregistrées, 18 tables avec FORCE RLS ; transaction sous le rôle runtime effectif : `rolsuper=false`, `rolbypassrls=false`, zéro recette visible sans contexte.
- Tests contre PostgreSQL embarqué réel (PGlite), pas seulement un simulateur SQL : backfill des données et comptes, clés homonymes, tombstones, rejet d’écriture inter-tenant, rôle restreint, absence de fuite de contexte, salon forgé dans le corps, accès signé sans membership, token historique, suspension et modification des droits sans impact sur un autre salon. Les tests API d’authentification utilisent désormais ce moteur également.
- `npm run db:schema:check && npm run lint && npm test && npm run build` réussis : **76/76 tests, 16 fichiers**, lint 0 erreur/avertissement et build OK. `git diff --check` OK.

### Limites et suite

- Pas encore de création publique d’une nouvelle organisation/salon, d’invitation inter-salons, de bascule UI ni de partition IndexedDB par salon. L’inscription initiale continue à utiliser le salon hérité ; une identité existante ne peut pas être écrasée par une création dans un autre salon.
- Les rôles restent Gérant/Caissier. Le filtrage des données sensibles et des écritures par rôle/entité reste à compléter : l’isolation inter-salons ne remplace pas le RBAC interne.
- Les sessions restent signées pour 30 jours, sans révocation ; les sessions courtes/refresh rotatif constituent le prochain lot, puis delta et contrôle par entité.
- Le serveur de cet environnement n’a toujours pas la connexion PostgreSQL secrète : le parcours navigateur → serveur hébergé → Supabase reste à valider après configuration privée. Les tests PostgreSQL locaux et les contrôles SQL distants ne sont pas présentés comme ce parcours complet.

## Étape 5 — Sessions courtes, révocables et renouvellement (livrée)

### Serveur et Supabase

- Migration `004_sessions` : sessions liées à une identité et un salon, famille d’appareil, hash SHA-256 du refresh, expiration, révocation, remplacement, IP et user-agent bornés. Aucun secret de renouvellement brut stocké en base.
- Accès signé de **15 minutes** avec `sid`, `tid`, `iat` et `exp`. Chaque route authentifiée vérifie une session vivante en base, puis l’appartenance et le rôle réels.
- Refresh opaque de 256 bits, durée absolue maximale **30 jours**, rotation à usage unique. Un rejeu révoque les sessions vivantes de sa famille, sans déconnecter les autres appareils.
- Le refresh est envoyé **uniquement dans un cookie HttpOnly**, SameSite=Strict, Path=/api/auth, Secure en production ; pas de refresh dans le JSON, le localStorage ou le sessionStorage. « Se souvenir de moi » contrôle la persistance du cookie.
- `POST /api/auth/refresh` et `POST /api/auth/logout`, limite commune 120/IP/15 minutes et contrôle d’origine. Déconnexion idempotente : révocation de la famille et effacement du cookie.
- Changement d’appartenance : révocation des sessions du compte dans ce salon. Changement de mot de passe : révocation de toutes les sessions de l’identité. Verrous transactionnels par identité et famille ; la connexion relit le hash après acquisition du verrou pour ne pas restaurer une session issue d’un ancien mot de passe.
- La création administrative `/api/users*` n’émet pas de session au nom du nouveau collaborateur.
- **Reconnexion obligatoire** : les anciens jetons sans `sid` enregistré ne sont plus acceptés par l’API. Cela remplace volontairement la compatibilité temporaire de l’étape 4 et évite 30 jours de sessions impossibles à révoquer.
- Supabase : migration `salon_pro_sessions` appliquée au schéma privé, 4 migrations enregistrées. Vérification distante : aucun droit de lecture anon/authenticated sur sessions ; rôle runtime autorisé à créer les sessions. Aucune modification des tables publiques existantes.

### Navigateur

- `sessionClient.ts` centralise le stockage du seul accès court, la lecture/rotation, le verrou anti-concurrence, le rejeu unique sur 401 et la révocation à la déconnexion.
- Renouvellement avant expiration, au retour d’onglet et avant synchronisation. Une promesse partagée regroupe les demandes d’un même onglet ; Web Locks sérialise les rotations entre onglets lorsque cette API est disponible.
- Pas de réactivation locale après une réponse de refresh arrivée après déconnexion/changement de compte. Un refresh d’une autre identité/salon ne remplace pas l’identité courante.
- Le stockage efface les accès périmés lors d’une connexion locale/sans jeton ; « ne pas se souvenir » n’abandonne pas un ancien jeton persistant.
- Un refus explicite de connexion Cloud ne déclenche plus silencieusement un login avec l’ancien mot de passe local. La continuité locale reste possible en cas d’indisponibilité réelle du réseau/serveur.

### Validation et limites

- `npm run db:schema:check && npm run lint && npm test && npm run build` réussis : **89/89 tests, 18 fichiers**, lint propre, build OK. PostgreSQL embarqué réel pour émission, rotation, rejeu, révocation, expiration et isolation des familles ; tests navigateur pour concurrence, rejeu 401, stockage, panne réseau et réponse après logout. `git diff --check` OK.
- Les tests ne simulent pas plusieurs connexions PostgreSQL concurrentes ni un vrai navigateur pour les cookies. Tests E2E HTTPS et de concurrence multi-instance encore nécessaires avant production.
- Rotation stricte, **sans fenêtre de grâce** : une réponse perdue puis un rejeu peut imposer une reconnexion. Si Web Locks est absent, la mutualisation reste intra-onglet ; une course entre onglets peut également forcer une reconnexion (échec sécurisé).
- Hors-ligne, le client efface sa connexion locale, mais ne peut garantir la révocation serveur ni effacer un cookie HttpOnly sans réseau. Ne pas présenter le logout hors-ligne comme une révocation confirmée.
- La table sessions est une table globale d’authentification, comme salon_users, protégée par le schéma privé et des requêtes explicites par session/identité. Elle n’est pas exposée au navigateur et ne passe pas par la synchronisation métier. Elle n’utilise pas les policies RLS des tables métier, puisque le refresh précède la résolution du salon.
- L’accès court reste accessible à JavaScript ; le chiffrement/vérificateur local par appareil (S9), la purge planifiée et l’écran des appareils restent à réaliser.
- Connexion PostgreSQL secrète du serveur Arena toujours absente : pas de revendication d’un parcours applicatif hébergé de bout en bout contre Supabase.

Prochain lot : synchronisation delta serveur-autoritaire et autorisations par entité, avant abonnements/console éditeur et expérience client.

## Étape 6 — Delta autoritaire et permissions par entité (livrée)

### Serveur, protocole et Supabase

- Migration `005_sync_revisions` : compteur transactionnel par salon, journal ordonné sur les 17 tables synchronisées, reprise des données existantes sans modification des écritures, index par ligne et compteur de lignes métier. Les deux tables de métadonnées ont FORCE RLS et des droits runtime limités.
- `POST /api/sync` accepte un curseur ; `GET /api/sync/pull?since=N&limit=1..500` renvoie une page de changements/suppressions. Le premier échange conserve un instantané complet. Curseurs invalides/futurs refusés, progression y compris sur des changements masqués au rôle, consolidation par ligne dans chaque page.
- Le serveur sérialise les synchronisations d’un salon, refuse les écrasements aveugles/obsolètes et ne fait plus confiance à l’horloge cliente pour départager des écritures. `updatedAt` mutable est attribué côté serveur. Un renvoi identique ne crée pas de révision ; un identifiant supprimé ne peut pas être ressuscité.
- Les mouvements de stock, bonus et journaux de correction existants sont immuables. Les autres conflits sont rejetés par ligne, sans annuler les lignes indépendantes acceptables ; une réponse HTTP 200 n’implique donc pas que chaque ligne soit acceptée. Les versions autoritaires lisibles sont renvoyées pour les refus.
- Caissier : écritures limitées à recettes, dépenses, sessions/mouvements de caisse et mouvements de stock ; aucune suppression autorisée. Lecture limitée à identité du salon, catégories, services, produits et ces tables opérationnelles. Employés, rémunérations, budgets et réglages ne sont pas transmis, y compris via les deltas et métadonnées de suppression.
- Migration distante `salon_pro_sync_revisions` réellement appliquée au projet BarberShop, schéma privé `salon_pro`. Vérifications : registre 001–005, 17 triggers, FORCE RLS sur les deux tables, aucun SELECT anon/authenticated, INSERT runtime autorisé. Aucun changement du schéma public ni du projet rent_voiture.

### Navigateur et conflits

- Envoi des seules lignes/tombstones modifiés depuis la baseline persistante ; lecture des pages avant le push puis drainage de la suite. Limite de 100 pages par drain : reprendre manuellement au checkpoint en cas de volume supérieur.
- Données, baseline, curseur et journal de conflits enregistrés dans une même transaction Dexie. Une page périmée ne fait pas reculer le checkpoint. Les saisies réalisées pendant un push restent modifiées lorsque leur version envoyée est acquittée ; cet acquittement est conservé lors du drainage des pages suivantes.
- Une version locale concurrencée est archivée avant remplacement par la version serveur. Une suppression locale devenue obsolète est également archivée, plutôt que réappliquée silencieusement après un pull. Les suppressions distantes sont conservées durablement dans `syncTombstones` et ne sont pas renvoyées à l’infini ; une suppression refusée est annulée localement et journalisée.
- Paramètres Cloud : journal JSON téléchargeable et indication du nombre d’entrées à l’ouverture. Le journal conserve un historique, pas un workflow de résolution automatique. Une opération rejetée doit être examinée avant ressaisie.

### Validation et limites restant ouvertes

- `npm run db:schema:check && npm run lint && npm test && npm run build` réussis : **98/98 tests, 19 fichiers**. Lint sans erreur/avertissement, `git diff --check` OK. Les anciens tests de synchronisation utilisent désormais PostgreSQL embarqué réel au lieu d’un simulateur SQL.
- Couverture ajoutée : horloges divergentes, idempotence, conflits et écritures sans curseur, suppressions/résurrection, isolation du journal, pagination, droits Caissier via API, delta Dexie, conservation d’une saisie pendant un push, archive durable, suppression locale obsolète/refusée et tombstones persistants.
- Ce n’est pas une validation E2E navigateur HTTPS → serveur hébergé → Supabase : la connexion PostgreSQL privée et le secret serveur restent à configurer dans l’environnement de déploiement, puis les courses multi-connexion doivent être testées sur PostgreSQL hébergé.
- Le premier instantané et le calcul client de baseline parcourent encore l’état complet. Le serveur relit/réapplique actuellement toute la collection des tombstones à chaque push. Ne pas présenter la complexité globale comme strictement proportionnelle au seul delta.
- Journal serveur et archives clientes sans rétention/compaction automatique ; pas d’interface accepter/réessayer/fusionner un conflit. Le volume des pages est limité en lignes, pas en octets.
- Le Caissier ne reçoit pas encore de projection publique des employés/réglages : l’affectation d’une prestation à un employé sur un nouveau poste et certains réglages de reçu nécessitent ce prochain travail de projection.
- Le cache IndexedDB reste lié au salon, **pas cloisonné par compte/rôle**. Le filtrage serveur n’efface pas des données sensibles déjà présentes sur un ancien poste de Gérant. Ne pas réutiliser ce profil comme poste Caissier sécurisé ; utiliser un profil séparé. Le changement de visibilité par rôle et sa réinitialisation de curseur restent à traiter avec cette partition locale.
- Déployer serveur et client ensemble, puis recharger les anciens onglets : un ancien client sans curseur ne peut plus modifier aveuglément une ligne distante. Le protocole d’invalidation/mise à jour PWA reste à construire.
- Prochain lot : fondations PWA (cache applicatif versionné, mise à jour sûre, statut hors-ligne), puis partition locale et projections de lecture par rôle avant de déclarer le parcours Caissier complet.

## Étape 7 — Socle PWA sûr (livré)

- Plugin de build sans dépendance PWA supplémentaire : worker versionné à partir des fichiers du build, précache de tous les chunks/publics nécessaires, intégrité SHA-256 et refus d’installation partielle. Les anciens caches restent utilisables tant que la nouvelle version n’est pas activée.
- Stratégie shell cache-first pour les navigations SPA et ressources explicitement précachées, sans cache dynamique. Les API, mutations, requêtes Authorization et origines tierces ne sont jamais interceptées. Aucun secret ni réponse métier dans Cache Storage.
- Activation normale après fermeture des anciens clients : ni skipWaiting, ni clients.claim, ni reload forcé. Information de mise à jour en attente et vérification au retour réseau/premier plan puis horaire.
- Statut hors-ligne explicitement distinct d’une synchronisation Cloud confirmée. Invitation d’installation selon support navigateur, manifeste SALON PRO et icônes PNG 192/512 plus Apple 180. Bandeau en flux normal, sans masquer le formulaire de caisse.
- Enregistrement uniquement pour le build de production, sur un contexte sécurisé et un navigateur compatible. En-têtes Vercel spécifiques au worker. Aucun changement SQL/Supabase nécessaire pour ce lot ; les finances passent toujours par l’API privée existante.
- Validation : **104/104 tests, 21 fichiers** ; `npm run db:schema:check`, lint, build et `git diff --check` réussis. Smoke test du worker généré avec les 39 vrais fichiers servis par HTTP et leur intégrité, puis fetch réseau coupé : route profonde disponible et API non interceptée.
- Limites : pas de test navigateur/installation OS réel disponible ici ; recette HTTPS et multi-onglets détaillée dans `PWA_TESTING.md`. Pas de Background Sync, pas de garantie contre l’éviction du stockage, pas de cache du serveur de développement. La première ouverture nécessite le réseau et le cache n’est pas une sauvegarde métier.
- Suite : partition locale par compte/rôle et projections de lecture employé/réglages pour compléter le parcours Caissier, sans effacer les données existantes. Les limites de connexion privée au serveur déployé et de cache partagé de l’étape 6 restent applicables.

## Étape 8 — Espaces locaux par compte/rôle et projections Caissier (livrée)

### Isolation applicative et conservation des données

- Chaque combinaison salon/compte/rôle dispose d’une base Dexie distincte, avec nom déterministe dérivé en SHA-256. Données, tombstones, baseline, curseur et journal de conflits ne sont plus partagés entre ces espaces. Les préférences/statistiques Cloud locales sont également nommées par espace.
- Le registre local des comptes reste dans la base historique pour la connexion hors-ligne ; ses hashes ne sont pas copiés dans les bases métier. Avant connexion et au logout, la vue métier est vide. Les routes attendent l’ouverture du bon espace.
- Les fonctions de mutation/sync restent attachées au dépôt de leur génération. Une fonction périmée ne peut pas commencer une opération sur le nouvel espace ; une saisie déjà lancée peut se terminer dans l’ancien dépôt mais ne repeuple pas la nouvelle vue. Les ouvertures concurrentes sont arbitrées par génération.
- Reprise de la base historique une seule fois, transactionnelle côté destination, pour un Gérant actif connu et compatible avec le rattachement salon. Un propriétaire de reprise est conservé dans les métadonnées. Jamais de copie automatique de la base métier historique vers un Caissier.
- La source historique reste intacte (hormis ses métadonnées de rattachement/reprise et son registre d’authentification). Écritures, tombstones et archives de conflits sont copiés, pas déplacés. L’ancien curseur/baseline n’est pas repris : le premier échange réconcilie les données sous les droits de cet espace et peut archiver des divergences.
- Passage compte local → compte Cloud de même e-mail/rôle : le registre conserve un lien de prédécesseur avant remplacement de l’identité ; le nouvel espace reprend le précédent cache personnel sans le supprimer. Un changement de rôle ne copie pas cet ancien cache. Autres fusions d’identités/salons non automatiques.

### Projections API et parcours Caissier

- L’API transmet désormais un annuaire employé public (id, nom/prénom, fonction, actif, dates techniques), sans téléphone, date d’embauche, salaire, prime, taux de commission ni note administrative. Les réglages transmis sont une allowlist d’affichage/reçu/configuration des prestations ; pas de date de sauvegarde ni de métadonnées internes.
- Même projection sur instantané initial, pages de delta et versions autoritaires renvoyées après refus. Droits d’écriture sur employés/réglages inchangés : réservés au Gérant.
- Les tentatives Caissier d’écriture de dépenses/mouvements explicitement liés à la paie sont refusées, même via les tables opérationnelles. Cela n’est pas une masquage de toutes les opérations de caisse : les dépenses et mouvements de paie déjà présents dans ces tables peuvent rester lisibles pour la comptabilité opérationnelle.
- Pas de calcul de paie dans les alertes Dashboard Caissier à partir de l’annuaire partiel. Les métadonnées purement locales de purge ne créent plus de faux changements à renvoyer après chaque projection de réglages.
- Première synchronisation demandée après ouverture d’une session Cloud, même sur un nouvel espace. Le bouton de synchronisation est accessible au Caissier connecté sans l’envoyer vers la page Paramètres réservée au Gérant. Les synchronisations automatiques déjà activées démarrent aussi à l’ouverture du contexte.
- Les suppressions déjà enregistrées sur le serveur sont idempotentes lors d’une reprise de cache, au lieu de générer artificiellement un refus pour chaque tombstone historique.

### Validation et limites

- **110/110 tests, 22 fichiers**, `npm run db:schema:check`, lint sans erreur/avertissement, build et `git diff --check` OK.
- Six tests de partition ajoutés : reprise unique sans suppression ni ancien curseur, absence d’héritage Caissier/autre compte, séparation rôle/salon, changement de contexte et logout, fin de saisie sur l’ancien espace sans pollution du nouveau, absence de renvoi des réglages de purge, passage local → Cloud. Tests API étendus aux projections initiales/delta/refus et au refus d’écriture de paie. Le test UI Prestations hydrate explicitement le cache Caissier via le contrat de projection plutôt que partager le dépôt Gérant.
- Aucun changement SQL nécessaire : le schéma privé Supabase reste en 001–005. Déployer le nouveau serveur applicatif et le client ensemble ; l’application hébergée et sa connexion privée restent à valider en HTTPS.
- **Partition logique, pas chiffrement ni sandbox de sécurité entre utilisateurs du même profil OS/navigateur.** Un script de la même origine ou une personne ayant accès aux outils développeur peut lire les différentes bases, le registre de hashes et les archives. Le hash du nom de base n’est pas un secret. Garder des profils navigateur/OS distincts pour un besoin de confidentialité forte sur poste partagé.
- Fermer tous les anciens onglets avant le déploiement. L’archive historique n’est pas synchronisée avec les nouvelles bases ; les anciens clients ne doivent plus y écrire. Une ancienne base exclusivement utilisée par un Caissier n’est pas adoptée silencieusement : sa récupération nécessite examen/export technique et attribution par un responsable, sans effacement.
- Un nouveau compte n’hérite pas du cache d’un autre compte et nécessite une première synchronisation Cloud pour retrouver les données partagées. Les changements de droits/révocations ne peuvent pas être garantis hors-ligne. Les limites d’onboarding multi-salon du registre local restent applicables.
- **Parcours Caissier pas encore déclaré complet côté stock/encaissement distribué** : le client peut générer un ticket, des mouvements et une quantité produit locale, mais le protocole actuel autorise les mouvements Caissier et refuse l’écriture du produit. Le serveur doit appliquer atomiquement ces effets et valider prix/liaisons, sans élargir arbitrairement les droits sur le catalogue. Prochain lot : commande d’encaissement serveur autoritaire et idempotente, avec stock dérivé, puis recette multi-postes sur PostgreSQL hébergé.

## Étape 9 — Stock Caissier dérivé et transactionnel (livrée, lot encaissement partiel)

- `server/cashierStock.ts` prépare les sorties Caissier sous le verrou transactionnel des révisions du salon. Ventes et consommations uniquement, delta entier strictement négatif, produit actif et usage compatible. Achats, pertes, ajustements/restock restent réservés au Gérant dans ce parcours.
- Le serveur lit les quantités/coûts actuels et calcule la quantité finale ; les `quantityAfter`, `unitCost` et date technique de création entrants ne font pas autorité. Produits dérivés, mouvements et recettes sont écrits dans la même transaction PostgreSQL et alimentent le journal de delta existant.
- Les snapshots produit accompagnant les mouvements ne permettent pas de modifier le catalogue : seuls quantité/timestamp sont ignorés quand les autres champs correspondent. Toute altération du nom/prix/coût/etc reste refusée ; le produit dérivé conserve le catalogue serveur.
- Concordance des liens dans les deux sens : vente ↔ recette/produit/quantité/mouvement, consommable ↔ référence dans une recette. Une recette produit sans mouvement, un mouvement orphelin, des doublons ou un lien vers une recette rejetée font échouer l’envoi. Pas de recette acceptée seule après refus de son stock.
- Le manque de stock provoque HTTP 409 et rollback de tout l’envoi, y compris les recettes et autres lignes qui auraient été acceptables. Le client conserve les opérations locales pour examen/reprise ; il ne reçoit pas un faux succès partiel.
- Les identifiants de mouvements sont immuables : un rejeu concordant reprend la version serveur sans nouvelle déduction ; les champs dérivés ne créent pas de faux conflits. L’ID ne doit pas changer lors d’une tentative de reprise.
- Un consommable déjà attribué ne peut pas être réutilisé pour une autre recette : contrôle des références acceptées et de l’historique tenant du journal. Le Caissier ne peut pas enlever/modifier les effets de stock d’une recette enregistrée ni l’archiver silencieusement ; une correction Gérant explicite est nécessaire.
- Dexie reconnaît les normalisations serveur des mouvements comme un acquittement, applique la version autoritaire et conserve toujours une vraie saisie faite pendant le push. Pas d’archive de faux conflit pour le seul recalcul coût/quantité/date technique.
- Validation : **118/118 tests, 23 fichiers**, schéma, lint sans avertissement, build et `git diff --check` OK. Huit tests nouveaux : sortie et coût dérivés, rejeu sans double débit, tentative d’altération catalogue, second poste avec curseur ancien et stock insuffisant/rollback recette, mouvement orphelin, deltas/doublons/recette sans mouvement, consommables/isolation salon, interdiction de réutiliser/enlever un lien, acquittement Dexie normalisé. Plusieurs assertions sont regroupées dans un même test.
- Aucune migration SQL requise : réutilisation de la transaction et du journal 001–005. Déployer le serveur ET le client pour le calcul et l’acquittement normalisé. Pas de test multi-connexion hébergé réel : le scénario deux postes est exécuté séquentiellement sur PostgreSQL embarqué.
- **Ce n’est pas encore la commande d’encaissement complète** : ce lot renforce `/api/sync` pour le Caissier. Les prix de vente/prestation, variantes, remises, paiements/splits, total de caisse et numérotation des reçus ne sont pas encore tous recalculés côté serveur. Le chemin Gérant reste le protocole existant de produits/mouvements ; il n’est pas unifié avec ce calcul dérivé.
- Les sorties manuelles Caissier sans recette et les mouvements positifs sont désormais refusés ; les retours/annulations doivent passer par un workflow Gérant à compléter. Un envoi contenant plusieurs tickets est intégralement annulé si l’un présente une erreur de stock.
- La recherche d’attribution des consommables dans le journal JSON n’a pas encore d’index spécialisé ; rétention/compaction et mesures de charge restent nécessaires.
- Prochain lot : commande ticket serveur unifiée, prix/variantes et paiements autoritaires, idempotence par commande et correction/restock traçable, puis E2E HTTPS multi-postes contre le serveur relié à Supabase.
