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

## Refonte guidée par le cahier cible — 31 octobre 2026 (lot 0 + début lot 1)

- Original fourni conservé sans modification dans `docs/reference/SALON_PRO_Cahier_des_charges_et_plan_refonte.md`, empreinte SHA-256 consignée. Analyse du code comparée aux exigences, carte des flux/endpoints, écarts et portes de sortie dans `docs/ANALYSE_ECARTS_CAHIER_DES_CHARGES.md`.
- Baseline réellement relancée sur `cecb99dc` : 118/118 tests, 23 fichiers ; schéma/lint/build/diff OK. Tag local de référence et compte rendu `docs/BASELINE_REFONTE.md`. L’ancien échec CI à l’étape tests reste ouvert ; pas de restauration Supabase ni de recette hébergée revendiquée.
- README réaligné sur l’ERP coiffure/beauté, Supabase privé, Dexie partitionné, sessions révocables et delta. Suppression des instructions obsolètes LWW/Dexie v2/PIN/fournisseur unique Neon du parcours recommandé ; compatibilité des noms internes préservée.
- Début **lot 1a** : `CheckoutCommand` et `CheckoutQuote`, validation stricte et devis commun serveur `POST /api/checkout/quote`. Catalogue/variantes/employés actifs tenant-scoped, entiers sûrs XOF, remises Gérant motivées et répartition exacte en BigInt, paiements nets/split/monnaie et caisse espèces ouverte, demande cumulée de stock produits+consommables standards.
- Contrat et limites dans `docs/CHECKOUT_SERVEUR.md`. Endpoint authentifié/rate-limité, devis `quoted`/`confirmed:false`, sans écriture financière, reçu, réservation ou consommation de clé. Pas de migration distante ni de bascule trompeuse du formulaire sur une fausse finalisation de devis.
- Transparence UI : « enregistré sur cet appareil » plutôt que « validé » après Dexie, note d’origine locale dans le ticket/reçu et référence locale indiquée sans modifier les valeurs historiques. Les vrais statuts par écriture et filtres de KPI restent à ajouter.
- Sécurité : règle de commission service retirée des projections Caissier (snapshots/deltas) ; détails Gérant conservés. Un JSON `null` déjà parsé est désormais remis à la validation plutôt qu’attendre indéfiniment un corps déjà consommé.
- 19 tests nouveaux de contrat/API/PostgreSQL et assertions UI/projection ajoutées. Validation complète finale : **137/137 tests, 24 fichiers**, schéma/lint/build/diff OK, consignée dans `docs/BASELINE_REFONTE.md`.
- **Lot 1 non terminé** : persistance atomique de commande, idempotence de commit, reçu serveur, protection contre contournement par sync héritée, pending/confirmed Dexie et bascule des deux rôles constituent les prochaines étapes. P0 commercial toujours No-Go ; lots CRM/SaaS/paiement/agenda non commencés.

## Refonte — lot 1b : finalisation transactionnelle (31 octobre 2026)

- `POST /api/checkout/commit` implémenté pour les deux rôles : session individuelle, acteur relu, verrou tenant commun à sync, recalcul catalogue/remise/paiements/stock puis recettes, sorties, caisse et résultat persistés dans une seule transaction.
- Registre tenant/clé + hash canonique + résultat immuable ; rejeu historique sans nouveaux effets, conflit de contenu/acteur explicite. Reçu `SPC-…` unique par salon, compteur annulé avec le rollback.
- Métadonnées serveur et triggers de protection des recettes/mouvements confirmés ; sync refuse altérations, tombstones et faux liens de ticket/recette officiels. Caisse protégée contre suppression/réécriture du fond et totaux recalculés depuis le journal, y compris anciennes sessions de mouvements déplacés/supprimés.
- Migration additive 006 **volontaire**, jamais lancée au démarrage ni par la CLI sans `--include-checkout` et approbation de sauvegarde/restauration vérifiées. Paquet Supabase local `supabase/optional/006_checkout.sql`, hors migrations automatiques. Une base 005 continue à synchroniser et refuse commit avec 503. **Aucun DDL distant exécuté, aucune sauvegarde/restauration revendiquée.**
- Contrat, réponse, déploiement et rollback documentés dans `docs/CHECKOUT_SERVEUR.md`, matrice et README actualisés.
- Validation complète : **147/147 tests, 25 fichiers**, schéma à jour, lint 0 erreur/avertissement, build et diff OK. Dix tests de plus depuis 1a : neuf scénarios commit PostgreSQL/API et un test d’opt-in migration. PostgreSQL embarqué mono-connexion : concurrence hébergée réelle toujours non prouvée. Avertissements non bloquants connus des graphiques en JSDOM et taille de chunk conservés.
- **Lot 1 reste partiel / No-Go production** : formulaire et file Dexie non branchés, anciennes créations financières sous d’autres références toujours possibles, corrections inverses et snapshots historiques employés/commissions à compléter. Prochaine étape : file durable pending/confirmed/rejected et acquittement commun aux deux rôles, sans double création par la sync historique.

## Refonte — lot 1c : outbox durable et formulaire pilote (31 octobre 2026)

- Dexie v6 : intentions immuables séparées des projections financières, clés persistées, scopes compte/salon/rôle vérifiés, pending/confirmed/rejected, bail durable multi-onglets et réessais temporisés. Aucun débit local anticipé et aucune copie de la file vers un autre espace/rôle.
- Validateur DTO pur partagé client/serveur, transport sous jeton fixe lié au compte (pas de retry 401 sous le compte suivant), timeout commit, contrôles de cohérence de l’ACK. L’acquittement ne réapplique pas des soldes historiques ni n’avance le curseur.
- Formulaire commun Gérant/Caissier, panneau des intentions et reçu canonique intégrés en **pilote `VITE_SERVER_CHECKOUT=true` désactivé par défaut**. Prix catalogue, consommables standards serveur ; date rétroactive, saisie libre, notes et consommables manuels non proposés dans le pilote. Aucun fallback vers une vente locale après erreur serveur.
- Sync préalable des changements locaux, traitement de la file, puis pull ordonné ; retry périodique si auto-sync actif, et bouton manuel. Les intentions pending n’entrent pas dans les KPI. Le cache financier peut rester en retard sur un ACK jusqu’au pull.
- Clôture locale bloquée pour espèces pending/mouvements confirmés non chargés. Import/reset bloqués si issue inconnue ; les ACK restent conservés après reset. Catégories comptables service/produit corrigées et centralisées pour ne pas confondre catalogue et recettes.
- **169/169 tests, 28 fichiers**, schéma, lint sans avertissement, build et diff OK. +22 tests : outbox/transport, deux parcours UI et intégration Dexie/API/PostgreSQL avec réponse perdue, autre vente et rejeu sans écraser le stock récent.
- Aucun DDL Supabase distant, aucune activation de production ni backup/restore prouvé. Le JSON de sauvegarde métier exclut la file ; supervision/résolution opérateur et sauvegarde/reprise dédiées restent nécessaires. Anciens chemins financiers, corrections, snapshots historiques employés/commissions et recette HTTPS/multi-connexion restent ouverts : **No-Go maintenu**. Documentation README/contrat/analyse actualisée.

## Refonte — lot 1d : supervision et reprise contrôlée (31 octobre 2026)

- Nouvelle route `POST /api/checkout/status`, strictement key-only et authentifiée : lit le résultat canonique de l’acteur/tenant sans créer une vente pour une clé absente. Verrou tenant, appartenance active, refus d’accès aux résultats d’un autre acteur, aucune consommation de reçu/clé/révision métier.
- Supervision locale dans le ticket : compteurs, filtres, pagination, vérification individuelle sous bail. Vérifier suspend sans renvoyer ; confirmation cohérente récupérée comme ACK, absence/non-conclusion conservée sans nouvelle vente. Historique local des contrôles/reprises, protections contre réponses tardives.
- Export dédié des intentions non confirmées, sans secrets/baux/résultats. Restauration atomique et bornée (1 000 intentions / 5 Mo), scope vérifié, clés originales, conflits sans remplacement. Toute nouvelle intention restaurée reste pending/suspendue ; aucun ACK de fichier n’est cru et le worker ignore les suspensions.
- Reprise explicite après lecture status not_found seulement pour une intention pending, avec confirmation utilisateur et même commande/clé. Refus métier existant non réactivé, pilote désactivé = pas de reprise UI ni envoi. Aucun bouton de suppression, annulation ou vente de remplacement.
- Contrat, procédure opérateur et limites documentés. La sauvegarde métier reste distincte ; le fichier de file est privé, non chiffré/non signé et ne remplace pas la sauvegarde PostgreSQL.
- **190/190 tests, 31 fichiers**, schéma/lint/build/diff OK ; 21 nouveaux tests API/RLS, récupération/backup et UI. Lint 0 avertissement ; notifications React act asynchrones non bloquantes dans les tests UI, graphiques JSDOM/chunk connus.
- Aucun DDL distant, aucune activation de production ni restauration hébergée prouvée. Changement de rôle, supervision des autres acteurs, corrections et fermeture globale des anciens chemins financiers restent ouverts. **No-Go P0 maintenu** ; prochaine porte : prévol des backlogs/clients et politique serveur de bascule financière sans perdre les anciennes intentions.

## Refonte — lot 1e : prévol et garde de bascule volontaire (31 octobre 2026)

- Mode serveur `SALON_CHECKOUT_SYNC_MODE=legacy|enforced`, défaut legacy. Enforced requiert 006 et approbation explicite ; erreur de configuration/prérequis = refus fermé sans écritures.
- Garde sous verrou tenant avant tout calcul/persist de sync : recettes historiques et effets de vente liés refusés, références inverses reconnues, no-ops/acquittements de tombstones connus préservés. Un refus annule **tout le push**, pour Gérant/Caissier et toute entrée passant par le moteur. Commit serveur reste le chemin d’écriture des nouvelles ventes.
- `POST /api/checkout/preflight` authentifié et tenant-scoped, diagnostic sans création financière, IDs uniquement, borné. Prévol du client **avant tout pull**, stockage du dernier diagnostic et affichage dans le panneau ; backlog bloqué conservé, sans nouvelle clé ni remplacement automatique.
- Après diagnostic enforced du scope : création/édition/archive locales de recettes héritées bloquées. Transport prévol/pull/push sous jeton capturé, sans retry sous un compte remplacé. Le nouveau client exige le prévol : déploiement client/serveur coordonné.
- `.env.example` et contrat documentent les portes : tous salons/appareils/instances, sauvegardes/restauration prouvées, rapprochement des anciens tickets, migration volontaire et pilote, puis seulement approbation serveur. **Aucune activation hébergée, aucun DDL distant.**
- Validation finale : **210/210 tests / 35 fichiers**, schéma/lint/build/diff OK ; +20 tests. Trois premières passes ont révélé des délais de démarrage SQL/lazy UI ; fixture WASM et module Dashboard préchauffés en setup, sans retrait d’assertion, réutilisation de données ou hausse des budgets d’assertion métier. Passe finale complète verte ; aucune conclusion sur la CI historique PR #2.
- Ce mode ferme les écritures de **vente** héritées, pas tous les mouvements manuels caisse/inventaire ni dépenses/paie. Corrections inverses, vraie recette HTTPS/multi-postes, preuve de backup/restore hébergée et autres portes restent ouvertes. **No-Go maintenu.**

### 31 octobre 2026 — Lot 2a : remboursements intégraux serveur

- Commande Gérant active, motif obligatoire, clé stable, remboursement intégral unique par ticket canonique ; registres et écritures inverses immuables, reçu SPR et endpoint de statut.
- Annulation atomique des recettes/paiements, espèces dans une caisse ouverte provisionnée ; retours produit explicitement sélectionnés au coût historique et CUMP pondéré. Aucun retour automatique des consommables.
- Corrections des commissions fixes/unités signées et coût des produits retournés. Protection sync/SQL/RLS des inverses.
- Migration 007 optionnelle PostgreSQL/Supabase privée, non appliquée à distance. CLI exige les deux attestations de sauvegarde pour 006+007 ; aucune activation ni déploiement.
- **221/221 tests, 36 fichiers, 219,54 s** ; lint/build/schema/diff verts. Contrat et exclusions dans `docs/CHECKOUT_SERVEUR.md`.
- Reste : UI et reprise offline remboursement, avoir imprimable, remboursements partiels, exécution prestataire. Références externes = attestations seulement. No-Go production maintenu.

### 31 octobre 2026 — Lot 2b : interface et reprise remboursement

- Interface Gérant sur les tickets confirmés de la file locale : motif, retours produits, caisse ouverte et références externes attestées.
- Persistance Dexie atomique avant envoi, une intention/clé par ticket/espace ; confirmation explicite. Issue incertaine persistée avant réseau, vérification seule puis reprise manuelle avec la même clé après `not_found`.
- Aucun rejeu automatique, changement de clé ni projection de snapshots financiers. Transport même origine/session capturée, validation des accusés, pilote désactivé par défaut.
- **234/234 tests, 37 fichiers, 209,58 s** ; lint/build/schema/diff verts. 12 nouveaux tests UI/persistance/transport et 1 intégration Dexie → API/SQL après réponse perdue.
- Restent : avoir imprimable, recherche serveur des tickets multi-postes, export/import de reprise remboursement, correction supervisée des intentions refusées, remboursement partiel et intégration prestataires. Suivi local non inclus dans la sauvegarde de file des ventes : ne pas effacer IndexedDB.
- 007 toujours optionnelle et non appliquée à distance ; aucun déploiement ni activation. Production No-Go maintenue.

### 31 octobre 2026 — Lot 2c : avoir imprimable confirmé

- Ajout d'un document d'avoir dédié après confirmation du remboursement, avec références SPR/SPC, motif, acteur, lignes historiques, total et modes de remboursement. Avertissement explicite : paiements externes attestés, non exécutés/vérifiés.
- Garde de cohérence des accusés locaux : scope/tenant/acteur/commande, signes, sommes et ventilations ; pas de fallback legacy ou d'avoir provisoire.
- Portail d'impression isolé, formats 80 mm/A5 et réimpression sans mutation/API ; nettoyage après impression, erreur, fermeture et changement de compte.
- **256/256 tests, 38 fichiers, 219,56 s** ; lint/build/schema/diff verts. 22 nouveaux tests ; intégrations reprise UI et API/SQL étendues jusqu'à l'éligibilité de l'avoir.
- Impression simulée en JSDOM, rendu navigateur/papier réel non vérifié. Identité du salon issue de la configuration locale actuelle, pas d'un snapshot légal. Aucun DDL/deploiement/activation ; production No-Go inchangée.

### 31 octobre 2026 — Lot 2d : sauvegarde/reprise des remboursements

- Format dédié `SALON_PRO_REFUND_INTENTS_V1`, 5 Mio / 1 000 intentions, même Gérant/salon/rôle ; export des intentions sans accusés, états ou mouvements/secrets.
- Import atomique, conflits de ticket/clé/contenu bloquants, états locaux existants préservés. Nouvelles intentions importées suspendues en vérification seule.
- Panneau autonome dans la file, pagination et contrôle serveur sans renvoi ; récupération de l'avoir possible même sans vente dans la file de l'appareil cible.
- Garde anti-réexécution depuis un fichier non signé : même `not_found` ne suffit pas à envoyer une intention importée. Contrôle canonique et reprise sous préconditions serveur restent nécessaires.
- **278/278 tests, 39 fichiers, 215,99 s**, lint sans avertissement/erreur, build/schema/diff verts. 22 nouveaux tests ; intégration SQL/API étendue à la restauration sur second espace.
- Fichier non chiffré/non signé ; ce n'est pas une sauvegarde PostgreSQL ni une preuve bancaire. Aucun DDL/deploiement/activation ; No-Go production maintenu.

### 31 octobre 2026 — Lot 2e : reprise supervisée après contrôle canonique

- Ajout des endpoints Gérant POST refund/review et refund/resume, isolés par tenant et soumis à la session active/rate limiting, sans nouvelle migration.
- Contrôle financier en lecture seule des métadonnées importées contre le ticket canonique ; aperçu des lignes/modes historiques et empreinte de comparaison liée au tenant, acteur et commande.
- Reprise UI explicitement confirmée, même clé/commande avec préconditions vérifiées sous verrou dans le moteur atomique ; droits, fonds, stock et unicité toujours revalidés.
- Les intentions importées ne sont pas libérées globalement : absence serveur puis contrôle cohérent requis ; transport dédié /resume, jamais /refund natif. Statut après réponse perdue invalide l'ancien contrôle. Export toujours sans préconditions/accusés.
- **294/294 tests, 39 fichiers, 232,60 s** ; lint/build/schema/diff verts, 16 tests ajoutés dont intégration sur second espace et récupération de réponse perdue.
- Correction d'intention/caisse refusée, recherche générale multi-poste, remboursement partiel et prestataires restent à traiter. Aucun DDL/déploiement/activation ; No-Go production inchangé.

### 31 octobre 2026 — Lot 2f : recherche serveur des tickets multi-postes

- Panneau Gérant de recherche SPC exact et/ou intervalle UTC (366 jours max.), consultation des ventes canoniques de tous les comptes du salon, sans import local ni recherche automatique.
- Endpoints POST history/search et history/detail : session/membership actives, RLS runtime, limites de débit, 006 requise. Pagination keyset 20 résultats avec précision microseconde, pas de total global.
- Annotation des remboursements via 007 ; sans 007, suivi explicitement indisponible. Détail historique, accès au reçu et formulaire de préparation existant seulement si non remboursé. Aucun mouvement/envoi avant les étapes de confirmation existantes.
- **317/317 tests, 41 fichiers, 247,22 s**, lint/build/schema/diff verts. 23 nouveaux tests API/SQL/UI/transport, incluant 22 tickets au même timestamp, isolation et préparation depuis un poste sans vente locale.
- Restent : legacy/recherche client, recette de charge, corrections d'intention/changement de caisse, remboursement partiel et prestataires. Aucun DDL/déploiement/activation ; No-Go production maintenu.

### 31 octobre 2026 — Exécution + lot 2g-a : diagnostic des blocages

- Application démarrée en développement sur 0.0.0.0:4173 ; accueil HTTP 200. Health `ok:true`, `databaseConfigured:false` : UI disponible, connexion PostgreSQL d'exécution non configurée dans cet aperçu.
- Diagnostic Gérant des intentions non confirmées : caisse absente/clôturée, journal/fonds insuffisants ou incohérents, produit/retour stock impossible. Endpoint authentifié et isolé, sans rapprochement persistant ni correction.
- Affichage en mémoire, réponse vérifiée contre compte/commande ; aucune clé, commande, permission de reprise ou écriture financière modifiée.
- **327/327 tests, 41 fichiers, 254,10 s**, lint/build/schema/diff verts. Dix nouveaux tests. Test de restauration stabilisé en attendant l'activation réelle du bouton avant clic ; assertions préservées.
- La correction effective/changement de caisse reste à implémenter : ce lot n'en constitue que le premier sous-lot diagnostic. Aucun DDL/déploiement/activation ; No-Go production maintenu.

### 31 octobre 2026 — Correction de configuration PostgreSQL (connexion externe encore requise)

- Connecteur Supabase vérifié : BarberShop actif, migrations privées 001–005 présentes ; aucune écriture distante.
- Correction du chargement des secrets serveur `.env.local` et variantes de mode dans Vite et les commandes DB, sans exposition client ni écrasement des variables de déploiement.
- Ajout `npm run db:check` : requêtes READ ONLY, statuts sûrs sans secrets/erreurs brutes ; aucun schéma ou jeu de données créé.
- **333/333 tests, 42 fichiers, 245,84 s**, lint/build/schema/diff verts. Six tests ajoutés sur les priorités, l'absence de configuration, les erreurs et les migrations en lecture seule.
- Aperçu redémarré sur 4173. La vraie connexion Cloud n'est pas corrigée à elle seule par ce code : aucune URI privée n'est disponible au runtime et un environnement autorisant la sortie PostgreSQL est nécessaire. Ne pas demander de mot de passe en conversation, inventer une connexion ou contourner les restrictions réseau.
- 006/007 non appliquées, aucune activation ; production No-Go inchangée.

### 31 octobre 2026 — Configuration Vercel dédiée

- Création et relecture du projet barbershop dans l'équipe connectée, sans lien Git ni déploiement automatique ; autres projets inchangés.
- Build Vite / npm ci / dist configurés ; trois indicateurs de sécurité false/legacy/false créés pour les trois environnements.
- Déclarations reproductibles dans vercel.json, région Dublin au futur déploiement, Node 22 dans package/lock ; liaison locale .vercel ignorée par Git.
- SUPABASE_DATABASE_URL et SALON_AUTH_SECRET restent à saisir dans les paramètres privés Vercel ; aucune valeur inventée ni récupérée d'un projet tiers.
- Lint/build/schema/diff verts, 7/7 tests ciblés configuration/sécurité. Suite complète 328/335, sept timeouts 5s (796,61 s), non entièrement verte ; aucun délai ou assertion modifié pour les masquer.
- Code non publié, aucun déploiement/DDL/activation. Étapes restantes dans VERCEL_SETUP.md. Production No-Go maintenue.

### 31 octobre 2026 — Reprise : fiabilisation des tests avant déploiement

- Les sept timeouts de la configuration Vercel restent consignés dans le passage historique ci-dessus ; ils ne constituent plus le résultat actuel.
- Un seul worker Vitest : évite la concurrence des moteurs PostgreSQL WASM et du hachage réel sur petit runner, sans modifier le délai de cinq secondes. Premier passage ciblé : 43/45, deux timeouts restants.
- Séparation de trois vérifications de migrations absentes, auparavant couplées à la création d’une deuxième base dans les scénarios droits/isolation (historique, review et diagnostic). Pas de suppression d’assertions, de réutilisation de base entre tests ou de changement du code métier.
- Validation finale : schema check, lint, **338/338 tests dans 43 fichiers** (383,38 s), build et diff check réussis. Journaux `.cache-vercel-resume-full-tests.log` et `.cache-vercel-resume-build.log` ; avertissement de taille des chunks non bloquant.
- Aucun déploiement, publication Git, migration hébergée ou activation financière effectué. Les variables privées Vercel restent à renseigner, la recette Cloud et le backup/restore restent non vérifiés ; production No-Go.

### 1er novembre 2026 — Lot sécurité et préparation de recette Cloud/financière

- Branche active arena/d9068337-barbershop, après fusion du lot précédent (PR #3).
- Ajout cloud:check en lecture seule : clé/configuration, connexion, registre, catalogues RLS et rôle runtime réellement activable. Profil financier : tables 006/007, triggers et alignement des pilotes. Sortie expurgée, échec fermé, aucune approbation automatique de production.
- Durcissement TLS node-postgres : hostname exact, certificat vérifié distant, neutralisation des paramètres URL qui pourraient remplacer TLS/routage/search_path. Régressions vérifiées sur les paramètres effectifs de pg.Client sans connexion externe.
- Instantané dotenv privé pour vérifier aussi les pilotes publics des fichiers, sans injection de VITE_* côté serveur ; timeout SQL local sur db:check.
- Nouvelle recette financière sur deux sessions API indépendantes : ACK perdu, statut canonique, rejeu idempotent, refus Caissier, remboursement/rejeu Gérant et rapprochement recettes/espèces/stock. test:financial regroupe la campagne ciblée ; aucun transfert Wave simulé.
- Vérifications externes en lecture seule : Supabase BarberShop sain, migrations 001–005 ; Vercel ne contient toujours que les trois pilotes désactivés. Les secrets DB/auth restent absents. Aucun changement hébergé ni déploiement.
- Validation : npm ci audit 0, lint, **355/355 tests dans 45 fichiers** (328,44 s), build, schema check et diff check réussis. Avertissement de taille des chunks non bloquant. Journaux .cache-cloud-financial-full-tests.log et .cache-cloud-financial-build.log.
- cloud:check réellement exécuté localement : blocked / missing_configuration, clé absente, sécurité non vérifiée ; résultat attendu, pas une connexion Cloud réussie.
- Procédure docs/RECETTE_CLOUD_FINANCIERE.md : portes manuelles, preuves privées, restauration en environnement isolé et arrêt sécurisé. Backup/restore, HTTPS et multi-poste réels restent non vérifiés. Production No-Go ; aucune migration 006/007 hébergée.

### 1er novembre 2026 — Rapprochement financier Gérant, strictement en lecture seule

- Ajout POST /api/checkout/reconciliation : session serveur, Gérant actif relu dans la transaction, tenant issu du jeton, corps vide strict, quota 6/minute par compte/salon et réponse no-store.
- Snapshot PostgreSQL REPEATABLE READ READ ONLY sous rôle runtime/RLS, timeout SQL cinq secondes, aucun verrou de lignes ni appel aux fonctions de recalcul qui écrivent ; rollback et restitution du client sur tous les chemins.
- Six compteurs : totaux canoniques, snapshots/projections, rattachements, soldes/clôtures de caisse, mouvements orphelins et mouvements invalides. 007 absente = couverture incomplète ; 006 absente = refus sans migration. Aucun bilan historique/inventaire ou paiement externe certifié.
- Interface Paramètres → Cloud PostgreSQL réservée au Gérant : lancement explicite, rapport volatile horodaté, portée expliquée, aucune correction automatique. Transport de même origine/jeton capturé, rejet des réponses d’un autre salon ou d’une ancienne session, validation des compteurs et de la cohérence du statut.
- 18 tests ajoutés : PostgreSQL réel PGlite (11) et interface/transport (7), dont refus natif READ ONLY d’une écriture injectée, corruption privilégiée uniquement sur fixtures jetables, clôture, accès/isolation et quota. Toutes les protections métier de production sont conservées.
- Validation complète : **373/373 tests, 47 fichiers**, 359,02 s ; lint/build/schema/diff verts. Journaux .cache-reconciliation-full-tests.log et .cache-reconciliation-build.log. Avertissement de taille des chunks non bloquant.
- Pas de déploiement, migration hébergée ou activation financière. Les prérequis privés et les preuves de restauration/recette Cloud du lot précédent restent requis ; production No-Go. Pas de nouvelle certification de connectivité hébergée.

### 1er novembre 2026 — Booking lot 1 : agenda interne optionnel

- Agenda authentifié `/booking`, navigation conditionnée par VITE_BOOKING_ENABLED=true. Lecture par compte actif, gestion réservée au Gérant. Aucun catalogue ou rendez-vous prérempli.
- API POST list/create/update : tenant issu de la session, contrôle d’appartenance/rôle, limite de débit, plages de consultation bornées et indicateur de troncature. Pas de réservation publique dans ce lot.
- Création idempotente (clé/hash/acteur), snapshots employé/prestation, durée manuelle 5–480 minutes ; pauses/indisponibilités sur le même agenda. Verrou transactionnel par salon avant vérification des chevauchements, bornes adjacentes autorisées. Pas de contrainte d’exclusion couvrant une écriture SQL privilégiée hors API.
- Déplacement avec version attendue et contrôle des conflits ; statuts Prévu/Confirmé/Arrivé/Terminé/Annulé/Absent. Aucun effacement : événements avant/après atomiques, rôle runtime sans DELETE et audit sans UPDATE/DELETE. Aucun encaissement/stock/commission créé par un rendez-vous, même terminé.
- Migration 008_booking indépendante de 006/007 et ignorée par défaut, export optionnel supabase/optional/008_booking.sql. CLI --include-booking exige SALON_BOOKING_BACKUP_VERIFIED=true ; accord opérateur après sauvegarde/restauration réellement vérifiées. Aucun changement de la base hébergée.
- Flags serveur/UI désactivés par défaut dans .env.example. Pas de file booking hors-ligne : erreurs conservatrices, clé gardée après échec en mémoire jusqu’à fermeture, réponse ancienne ou d’un autre salon ignorée ; relecture requise après réponse incertaine.
- 29 tests ajoutés (11 PostgreSQL PGlite, 9 validation/snapshot SQL, 8 interface/transport, 1 opt-in migration). Vérifications d’atomicité, isolation, permissions, indisponibilités, conflits, versions, transitions, ordre du verrou et absence d’effet financier. La concurrence réelle multi-connexion PostgreSQL reste à recetter.
- Validation complète : **402/402 tests dans 50 fichiers**, 379,65 s ; lint sans avertissement, build/schema/diff verts. Journaux .cache-booking-full-tests.log et .cache-booking-build.log ; avertissement de taille de chunks non bloquant.
- Limites détaillées dans docs/BOOKING.md : réservation publique/rappels, horaires automatiques/fuseau salon, CRM et lien caisse restent à réaliser. Pas d’activation ou déploiement ; production No-Go.
- État externe connu depuis la vérification précédente : secrets Vercel Sensitive présents uniquement en Production, valeurs non déchiffrées, aucun déploiement. Configuration locale/Preview et connexion réelle non vérifiées. Ne pas confondre cette présence avec une recette Cloud réussie.


## Marketplace — PROMPT 02, tranche 02A (1er novembre 2026)

Suite à l’autorisation de démarrer et au choix utilisateur React/Vite sans Next.js, début du socle **local** des profils publics : migration additive optionnelle `009_marketplace_profiles`, quatre tables privées (brouillon, gate, projection publiée, événements), RLS FORCE, FK tenant-composites, rôle lecteur serveur strict, triggers de fermeture à suspension et événements append-only. Publication runtime interdite en attendant les commandes dédiées ; aucun profil/compte fictif ou seed ajouté.

Le registre n’applique pas 009 sans opt-in. Le CLI impose `--include-marketplace` et une approbation privée backup/restore ; aucune de ces options n’a été exécutée sur une base réelle. Le snapshot est généré et les DTOs publics sont une allowlist sans identifiants privés. Tests PostgreSQL embarqués couvrant isolation, visibilité, grants, références inter-salons, compatibilité avec 008 et rollback.

Validation finale : **420/420 tests, 51 fichiers** (344,10 s), lint sans erreur/avertissement, build/schema/diff réussis. `db:check` en lecture seule reste `missing_configuration` ; aucun diagnostic hébergé prêt acquis. Voir [02_DATA_FOUNDATION.md](docs/marketplace/02_DATA_FOUNDATION.md) pour le périmètre exact, les résultats, les limites et le rollback. Pas encore d’API/interface Visibilité, de média, d’horaires, de réservation publique ou d’abonnement. Les migrations 001–008 et le moteur financier/booking restent inchangés. **Tranche 02A seulement, pas PROMPT 02 entier.** Aucune preuve de restauration hébergée : DDL distant bloqué et No-Go production maintenu.

## Marketplace — PROMPT 02, tranche 02B (1er novembre 2026)

Socle local des horaires ajouté par migration volontaire `010_marketplace_scheduling` : semaine type, exceptions datées, snapshot publié avec fuseau/révision, cinq tables FORCE RLS et FK tenant-composites. Fenêtres locales en `int4multirange` natif, fermé par défaut, override complet des journées exceptionnelles. Notes privées jamais projetées ; reader/runtime sans droit de publication. Migration 009 non réécrite.

Validation fraîche : **455/455 tests, 53 fichiers** (362,70 s), lint sans erreur/avertissement, build/schema/diff réussis ; hashes de 009 inchangés. `db:check` reste `missing_configuration` en lecture seule. Opt-in séparé `--include-scheduling`, impliquant 009 mais pas booking/finance, soumis au garde d’approbation backup/restore. `--include-marketplace` garde sa portée 009 seulement. Types/validations/DTO et tests SQL/RLS/upgrade/rollback ajoutés ; détails et résultats dans [02B_SCHEDULING_FOUNDATION.md](docs/marketplace/02B_SCHEDULING_FOUNDATION.md). Pas de nouveau formulaire/API, pas de slot UTC/DST, pas de connexion des horaires à l’agenda existant. Aucun DDL distant ou activation ; No-Go production maintenu.

## Marketplace — PROMPT 02, tranche 02C (1er novembre 2026)

Catalogue de prestations publiques et règles associées ajoutés au niveau données/domaine : migration volontaire `011_public_catalog`, quatre tables FORCE RLS (offres privées/publiées, règles privées/publiées), FK tenant-scoped vers les prestations authentiques et validation de variante. Prix XOF/durées dérivés du catalogue ou de sa variante, jamais du prix fourni par le visiteur. Source modifiée/inactive/périmée masquée, réactivation sans republication automatique ; suppression source compatible avec la purge par cascade limitée au catalogue public dérivé.

Validation complète : **489/489 tests, 55 fichiers** (398,74 s), lint sans erreur/avertissement, build/schema/diff réussis, hashes 009/010 inchangés. `db:check` reste `missing_configuration`. Règles explicites de pas, délai minimum, horizon local, marges, annulation et choix employé ; validation de domaine/DTO sans données privées. Opt-in séparé `--include-public-catalog`, dépendance 009 uniquement ; 010/008/finance restent indépendantes. Aucune API/UI/publication/prise de RDV publique livrée dans ce lot. Pas de DDL distant ni de migration historique réécrite ; backup/restore hébergé non prouvé, No-Go maintenu. Détails et preuves : [02C_PUBLIC_CATALOG.md](docs/marketplace/02C_PUBLIC_CATALOG.md).

## Marketplace — PROMPT 02, tranche 02D (1er novembre 2026)

Fondation médias privée/publique ajoutée : migration volontaire `012_marketplace_media`, quatre tables FORCE RLS (originaux, variantes, projection et événements immuables), cycle de traitement sans résurrection, rôle SQL worker restreint, fermeture transactionnelle et DTO public sans chemins privés. Limites explicites et validation de preuves côté domaine ; sniffing de signature seulement, pas de décodage de sécurité. Opt-in indépendant `--include-media` (009 seulement), soumis au garde backup/restore ; sources/exports 009–011 inchangés.

Validation complète : **514/514 tests, 57 fichiers** (422,72 s), lint sans avertissement/erreur sur 229 fichiers, build/schema/diff réussis. `db:check` reste `missing_configuration`. Aucun provider/bucket/upload, worker durable, endpoint ou UI activé. Pas de DDL distant, déploiement ou modification du logo privé historique. Backup/restore hébergé non prouvé : No-Go production et PROMPT 02 partiel maintenus. Voir [02D_MEDIA_FOUNDATION.md](docs/marketplace/02D_MEDIA_FOUNDATION.md) pour les garanties, limites et le repli.

## Marketplace — PROMPT 02, tranche 02E (1er novembre 2026)

Outbox de notifications locale ajoutée par migration volontaire `013_notification_outbox`, indépendante des migrations optionnelles 006–012 : enveloppes de métadonnées sans destinataire/secret, déduplication par tenant, cycle borné, baux temporaires et événements immuables. RLS FORCE et rôle worker SQL restreint ; runtime lecture seule, aucun envoi navigateur. Primitives serveur de claim SKIP LOCKED, complétion avec jeton et récupération des baux expirés ; aucun cron, transport, producteur métier ou endpoint enregistré.

Validation : **525/525 tests, 58 fichiers** (436,28 s), lint sans erreur/avertissement sur 232 fichiers, build/schema/diff verts, hashes 009–012 inchangés. Tests de récupération, fencing de jeton, retry/plafond, isolation et rollback ; concurrence multi-connexion et idempotence fournisseur non recettées. Opt-in `--include-notifications` soumis au garde backup/restore, sans activation implicite de 009. `db:check` reste `missing_configuration` ; aucun DDL distant/déploiement. Preview Vite 4173 HTTP 200. PROMPT 02 reste partiel et production No-Go. Détails : [02E_NOTIFICATION_OUTBOX.md](docs/marketplace/02E_NOTIFICATION_OUTBOX.md).

## Marketplace — PROMPT 02, tranche 02F (1er novembre 2026)

Migration volontaire `014_appointment_services` ajoutée : captures historiques immuables des prestations/variantes d’un rendez-vous 008, avec acteur et instant, prix XOF et durée dérivés du catalogue authentique. FK parent/acteur tenant-composites, RLS FORCE, runtime lecture seule, aucun accès navigateur. Les sources sont vérifiées à la capture sans FK historique bloquant leur purge ; les captures restent conservées. DTO privé et total historique borné sans effet financier.

Opt-in `--include-appointment-services` implique 008 seulement et exige au CLI les deux approbations backup/restore Marketplace et Booking. Aucun backfill ou raccordement à createBooking : les rendez-vous existants restent inchangés. Capture complète du panier, intervalle/durée et acteur public restent à implémenter dans les futures commandes, pas simulés ici.

Validation : **549/549 tests, 60 fichiers** (451,35 s), lint sans erreur/avertissement sur 236 fichiers, build/schema/diff réussis ; hashes 008–013 inchangés. `db:check` reste `missing_configuration`, preview Vite 4173 HTTP 200. Aucun DDL distant/déploiement ; preuve de restauration hébergée absente, No-Go maintenu. Rapport et matrice des restants PROMPT 02 : [02F_APPOINTMENT_SERVICE_SNAPSHOTS.md](docs/marketplace/02F_APPOINTMENT_SERVICE_SNAPSHOTS.md). PROMPT 02 partiel, notamment droits/souscriptions et contraintes de réservation publique non livrés.

## Marketplace — PROMPT 02, tranche 02G (1er novembre 2026)

Migration volontaire `015_schedule_blocks` ajoutée, indépendante de 006–014 : blocages privés salon/employé multijours, instants finis, enveloppe immuable et annulation sans résurrection. RLS FORCE, runtime lecture seule, acteurs Gérant vérifiés et audit append-only. FK employé tenant-composite détachée à la purge sans transformer le bloc en fermeture salon ; référence historique conservée et événement système sans faux acteur humain. Validation UTC stricte et primitive privée de chevauchement demi-ouvert.

Validation : **581/581 tests, 62 fichiers** (471,68 s), lint sans erreur/avertissement sur 240 fichiers, build/schema/diff réussis ; hashes 008–014 inchangés. Opt-in indépendant `--include-schedule-blocks`, garde backup/restore Marketplace. Aucun branchement aux commandes booking, écran ou endpoint ; aucune garantie nouvelle de disponibilité/concurrence publique. `db:check` reste `missing_configuration`, preview Vite 4173 HTTP 200. Pas de DDL distant/déploiement, restauration hébergée non prouvée ; No-Go maintenu. Rapport : [02G_SCHEDULE_BLOCKS.md](docs/marketplace/02G_SCHEDULE_BLOCKS.md). PROMPT 02 reste partiel, notamment plans/droits/souscriptions et contraintes de réservation publique.

## Marketplace — PROMPT 03, tranche 03A fonctionnelle (1er novembre 2026)

À la demande explicite de passer aux fonctionnalités selon le plan tout en consignant les avancées : première livraison du module Gérant « Visibilité en ligne » (`/visibility`). Chargement, création/modification du brouillon (nom, description, ville, commune, téléphone) et aperçu React non publié. API POST read/save authentifiée, tenant/acteur issus de session, Gérant actif relu, RLS, verrou/version et audit atomique ; aucune publication/écriture financière. Client lié à l’espace/session, relecture obligatoire après erreur, aucune sauvegarde locale de remplacement. Navigation et route réservées au Gérant.

Flag serveur SALON_VISIBILITY_ENABLED=false par défaut ; 009 requise, aucune migration automatique. Activation hébergée non réalisée, configuration locale manquante. Uploads/galerie, champs supplémentaires, catalogue/horaires et publication restent à livrer ; pas de faux provider ni de droit commercial inventé. PROMPT 02 et PROMPT 03 restent partiels.

Validation : **591/591 tests, 64 fichiers** (480,09 s), lint sans erreur/avertissement sur 246 fichiers, build/schema/diff réussis. 6 tests API/PG + 4 tests UI ajoutés. Preview `/visibility` HTTP 200 sans recette navigateur Cloud authentifiée. `db:check` reste missing_configuration ; aucune migration distante, secret/provider ou déploiement modifié. Rapport : [03A_VISIBILITY_DRAFT.md](docs/marketplace/03A_VISIBILITY_DRAFT.md). Prochaines tranches fonctionnelles : compléter profil, sélection catalogue/horaires, publication avec droits explicites et stockage sécurisé. Production No-Go maintenu.

## Marketplace — PROMPT 03, tranche 03B fonctionnelle (1er novembre 2026)

Suite du plan implémentée : slogan, catégorie libre, adresse publique, WhatsApp international, email, site HTTPS et liens Facebook/Instagram/TikTok raccordés à l’éditeur Gérant, aperçu et sauvegarde serveur du brouillon. Validation partagée (longueurs, HTTPS sans credentials, domaines sociaux exacts, contacts), affichage texte sans fetch externe. Version et audit communs au profil ; sauvegarde atomique des détails, omission par ancien client préservée, effacement explicite et aucune publication automatique.

Migration additive volontaire `016_profile_details`, FK tenant-composite 1:1, RLS FORCE, aucune lecture navigateur/public ; opt-in `--include-profile-details` implique 009 seulement et exige approbation backup/restore Marketplace. Parcours Visibilité de cette version exige 009+016 ; flag serveur reste false par défaut. Anciennes sources/exports 009–015 inchangés. Aucun DDL distant, seed, provider ou déploiement ; configuration Cloud locale toujours manquante.

Validation : **619/619 tests, 65 fichiers** (526,26 s), lint sans avertissement/erreur sur 249 fichiers, build/schema/diff/hashes réussis. 28 tests supplémentaires couvrent détails, compatibilité, RLS/FK, rollback, validation et UI ; 6 tests API 03A réexécutés. `db:check` missing_configuration ; aperçu `/visibility` HTTP 200 sans recette Cloud authentifiée. Rapport : [03B_PROFILE_DETAILS.md](docs/marketplace/03B_PROFILE_DETAILS.md). Suite : prestations/horaires fonctionnels, puis publication avec droits explicites et médias sécurisés. PROMPT 03 partiel et No-Go production maintenu.

## Marketplace — PROMPT 03, tranche 03C fonctionnelle (1er novembre 2026)

Prestations et horaires raccordés à l’éditeur Gérant : lecture des offres/variantes authentiques et de leurs prix/durées ERP, sélection/désélection, semaine de sept jours avec plages multiples et exceptions datées remplaçant une journée complète. Fuseau lu dans tenants, aucune heure commerciale préremplie ni disponibilité publique calculée. API POST config/read et config/save authentifiée, version commune au profil, verrou partagé, sources relues/verrouillées, sauvegarde et événement atomiques ; relecture requise après conflit/erreur.

Migration volontaire `017_visibility_editor` : membership tenant/profil/prestation privé et clé composite additionnelle, FORCE RLS, aucun grant navigateur/public. Désélection sans supprimer le brouillon 011 pour préserver les copies publiées ; notes privées des exceptions retenues préservées et jamais exposées. Les exceptions retirées sont supprimées explicitement avec leur éventuelle note. Opt-in `--include-visibility-editor` implique 009/010/011/016/017 uniquement, garde backup/restore Marketplace ; anciens opt-ins inchangés. Publication/photos restent fermées, aucun changement de prix ERP ou de rendez-vous.

Validation : **642/642 tests, 68 fichiers** (583,80 s), lint sans erreur/avertissement sur 256 fichiers, build/schema/diff réussis. 23 tests supplémentaires API/SQL/domaine/CLI/UI/registre ; hashes 009–015 inchangés, source/export 016 non modifiés. `db:check` missing_configuration et aperçu `/visibility` HTTP 200 sans recette Cloud authentifiée. Aucun DDL distant, secret/provider ou déploiement. Rapport : [03C_SERVICES_AND_HOURS_EDITOR.md](docs/marketplace/03C_SERVICES_AND_HOURS_EDITOR.md). Publication sous droits explicites, photos avec stockage sécurisé, portail et réservation publique restent à réaliser ; No-Go production maintenu.

## Marketplace — PROMPT 03, tranche 03D fonctionnelle (1er novembre 2026)

Panneau Gérant d’état de visibilité et contrôles préliminaires ajouté à `/visibility`, avec version/révision séparées, publication explicitement bloquée faute d’autorité de droits et dépublication confirmée. API privée read/unpublish ; tenant/acteur de session, version attendue, audit et fermeture atomiques. Migration volontaire `018_visibility_unpublish` ajoute une fonction SECURITY DEFINER étroite, tables qualifiées/search_path pg_catalog, grants navigateur révoqués ; aucun UPDATE direct de gate ou droit de publier accordé au runtime.

Dépublication ferme la lecture publique DB sans supprimer copie/brouillon/historique ou toucher finance/rendez-vous. Aucun droit commercial nécessaire à cette fermeture, mais Gérant/tenant actif et flag opérateur restent obligatoires. Opt-in `--include-visibility-unpublish` implique 009 uniquement ; parcours web exige aussi 016. Aucune activation distante. Checklist préliminaire seulement, pas de validation complète du panier/médias/droits ; aucun cache public/CDN prétendument invalidé.

Validation : **653/653 tests, 70 fichiers** (598,74 s), lint sans avertissement/erreur sur 262 fichiers, build/schema/diff réussis. 11 tests supplémentaires SQL/API/UI/DTO/CLI/registre, dont lecture publique avant/après, rollback audit/DDL, no-op et conflit. `db:check` missing_configuration ; aperçu `/visibility` HTTP 200 sans recette Cloud HTTPS authentifiée. Rapport : [03D_PUBLICATION_CONTROL.md](docs/marketplace/03D_PUBLICATION_CONTROL.md). Suite bloquant la mise en ligne : droits explicites/politique d’activation, projection complète et stockage sécurisé pour les photos. PROMPT 03 partiel, backup/restore hébergé non prouvé et No-Go production maintenu.

## Marketplace — PROMPT 03, tranche 03E : ESSENTIEL et abonnements (1er novembre 2026)

Décisions commerciales recueillies explicitement : ESSENTIEL 4 900 XOF/mois glissant, 1 établissement, 2 comptes (1 Gérant/1 Caissier), 5 collaborateurs, 3 photos, 10 prestations visibles, ERP standard et contacts/demandes inclus ; rendez-vous à confirmer, pas de réservation automatique. Ancrage calendaire initial conservé avec dernier jour si nécessaire ; grâce 3 jours lecture/visibilité seulement, activation manuelle auditée après vérification externe réelle. Aucun autre forfait ou prix inventé.

Migration volontaire indépendante `019_saas_subscriptions` : plans versionnés immuables/entitlements typés, périodes tenant-scoped avec ancrage/fuseau, références d’attestation, révocation irréversible et événements immuables. FORCE RLS, runtime lecture de période uniquement sans références sensibles, aucune écriture d’activation. Calcul mensuel/DST et droits actif/grâce/expiré/révoqué/suspendu avec refus par défaut. API et panneau Gérant de consultation ajoutés ; offre affichée comme configuration approuvée, pas comme souscription active. Aucune seed ou souscription réelle créée.

Validation : **674/674 tests, 73 fichiers** (588,40 s), lint sans erreur/avertissement sur 269 fichiers, build/schema/diff réussis ; 21 tests supplémentaires politique/SQL/API/UI/CLI/registre. `db:check` missing_configuration ; aperçu `/visibility` HTTP 200 sans recette Cloud authentifiée. Aucun DDL distant/provider/secret/déploiement. Rapport [03E_ESSENTIEL_SUBSCRIPTIONS.md](docs/marketplace/03E_ESSENTIEL_SUBSCRIPTIONS.md), décisions ajoutées à ADR-005. Restants explicites : contrôle plateforme authentifié, vérification de preuve réelle, quotas atomiques et branchement des droits au gate/publication/médias/demandes. La fermeture à échéance est une politique calculée, pas encore un effet appliqué au gate 009. Aucune caisse/donnée réelle bloquée pour impayé. No-Go production maintenu.

## Marketplace — PROMPT 03, tranche 03F : activation opérateur privée (1er novembre 2026)

Activation manuelle ESSENTIEL implémentée par CLI privée et identité PostgreSQL nominative restreinte, jamais par Gérant/Caissier. Migration additive opt-in 020 (implique 019 seulement), rôle de capacité NOLOGIN sans membre attribué, fonction SECURITY DEFINER à attribution session_user et refus de privilèges larges. Aperçu sans écriture, double confirmation CLI + attestation externe JSON ; plan/période/audit/reçu immuable atomiques, rejeu stable et déduplication globale des références externes par namespace. Fichiers POSIX privés bornés et URL dédiée sans fallback ERP. Aucun abonnement réel ni opérateur provisionné ; vérification bancaire/Mobile Money toujours humaine, pas de preuve automatisée.

Validation : **687/687 tests, 75 fichiers** (559,41 s), lint sans erreur/avertissement sur 275 fichiers, build et schema réussis. Avertissement bundle 618,04 kB conservé. Rapport/runbook : [03F_PLATFORM_ACTIVATION.md](docs/marketplace/03F_PLATFORM_ACTIVATION.md). Aucun DDL distant/déploiement/commit/push. Provisionnement, TLS/rôles/restore hébergés et contrôle MFA/SSO non livrés. Droits non branchés au gate 009, quotas non appliqués et fermeture d’expiration non effective : publication toujours bloquée, No-Go production maintenu. Prochaine tranche : enforcement serveur des droits et quotas avant publication.

## Marketplace — PROMPT 03, tranche 03G : droits du précontrôle publication (1er novembre 2026)

Résolution serveur commune des abonnements ajoutée (horloge PostgreSQL, tenant explicite + RLS, statut relu), partagée par consultation Gérant et contrôle préliminaire de publication. Blocages migration/droit actif explicites et comptage des prestations sélectionnées face au quota approuvé. Aucun effacement/bridage de brouillon ni blocage ERP. Dépublication toujours disponible sans abonnement. Publication maintenue fermée par pipeline incomplet : ce précontrôle n’est pas un enforcement atomique, n’ouvre aucun gate et ne masque pas à expiration.

Validation : **689/689 tests, 75 fichiers** (588,01 s), lint sans erreur/avertissement sur 276 fichiers, build réussi avec avertissement bundle existant. Régression droits absents, révocation relue et cross-tenant ajoutée. Rapport : [03G_SUBSCRIPTION_PUBLICATION_PREFLIGHT.md](docs/marketplace/03G_SUBSCRIPTION_PUBLICATION_PREFLIGHT.md). Aucun DDL distant/activation réelle/déploiement. Suite : contrôles SQL atomiques de publication et gate/expiration, médias et tests de seuil/concurrence. No-Go production maintenu.

## Marketplace — PROMPT 03, tranche 03H : quotas atomiques et expiration effective (1er novembre 2026)

À la demande explicite de dépasser le précontrôle : migration volontaire 021 ajoutée, avec compteurs privés transactionnels et triggers SQL sur projections de prestations/photos et réservations de médias. Plafonds ESSENTIEL 10 prestations / 3 photos, 3 médias en cours ou prêts ; incréments atomiques, rollback/upsert/suppressions cohérents. Verrou tenant et périodes ; fermetures de sécurité ERP autorisées sans abonnement, brouillons et caisse préservés. Quotas comptes/collaborateurs ERP hors de cette tranche.

RLS restrictive du gate public raccordée aux périodes réelles : maintien en grâce si gate ouvert, masquage à la fin des 72 h ou révocation sur nouvelle lecture, sans cron ni suppression ; horloge DB réelle même dans transaction ancienne. Panneau Gérant raccordé à cette autorité si 021 présente. Aucun droit de publier ajouté au runtime. Opt-in --include-public-access-enforcement, backup/restore Marketplace requis, implique 009/011/012/019 seulement outre le socle ; pas d’application distante ni abonnement réel.

Validation finale : **696/696 tests, 76 fichiers** (611,77 s), lint sans erreur/avertissement sur 281 fichiers, build/schema réussis, avertissement bundle existant. Sept tests SQL supplémentaires. Recette multi-connexion **PostgreSQL 17.11 local réellement exécutée** : attente de verrou et refus du 4e upload, rejet snapshot RR obsolète, 3 succès sur rafale de 8 connexions, rollback libérant sa réservation. Cluster privé arrêté ; script reproductible ajouté sans dépendance nouvelle. Rapport : [03H_ATOMIC_QUOTAS_AND_EXPIRY.md](docs/marketplace/03H_ATOMIC_QUOTAS_AND_EXPIRY.md). Premier timeout auth transitoire et erreur de type build corrigés/revalidés sans augmenter les délais. La fermeture DB est effective, pas une garantie CDN/stockage : publication web reste bloquée pour commande complète/médias sécurisés/recette Supabase et HTTPS. No-Go production maintenu pour ces restants.

## Marketplace — tranche 03I : demande de migrations distantes, précontrôle (1er novembre 2026)

Demande explicite d’application distante reçue. Supabase BarberShop pfiuujyybxtpoetdkmbc vérifié en lecture seule : ACTIVE_HEALTHY, PostgreSQL 17.11, salon_pro avec 28 tables, registre 001–005 seulement, 1 tenant et 0 compte. 006–021 restent non appliquées. Aucun autre projet modifié.

L’utilisateur confirme « Sauvegarde seulement » à la vérification sauvegarde ET restauration. Écritures distantes suspendues conformément au garde-fou existant ; aucun flag BACKUP_VERIFIED forcé, DDL/DML, abonnement ou rôle attribué. Procédure et périmètre consignés dans [03I_REMOTE_MIGRATION_PREFLIGHT.md](docs/marketplace/03I_REMOTE_MIGRATION_PREFLIGHT.md). Restauration réelle en environnement isolé et validation de la série manquante sur cette copie nécessaires avant basculement. Cette tranche modifie uniquement la documentation ; les 696 tests précédents ne sont pas une preuve de restauration distante. No-Go maintenu.

### 03I — Cible confirmée et coexistence des schémas

Utilisateur : nouveau projet, référence confirmée pfiuujyybxtpoetdkmbc. Audit distant en lecture seule : `public` 19 tables et `salon_pro` 28 tables coexistent ; aucune FK croisée, registre 001–005. Comptages sélectionnés publics tenants/services/appointments et privés comptes/recettes/dépenses/sessions caisse à zéro ; tenant structurel privé 1. Ne pas généraliser ces comptages à toutes les données. Les migrations du dépôt restent destinées à salon_pro et ne remplacent pas le modèle public de la capture. Aucune écriture distante ni restauration prouvée ; détails ajoutés au rapport 03I.

## Marketplace — tranche 03J : base officielle configurée (1er novembre 2026)

Projet pfiuujyybxtpoetdkmbc enregistré comme cible officielle dans le code et .env.example, schéma salon_pro conservé sans toucher public. Garde-fou serveur sur SALON_SUPABASE_PROJECT_REF : refus de cible PostgreSQL hors projet, acceptation direct/pooler authentifié par suffixe projet, TLS strict et schéma privé maintenus. Variable non secrète réellement créée puis relue sur Vercel barbershop, production seulement. SUPABASE_DATABASE_URL et SALON_AUTH_SECRET sensibles existantes constatées sans décryption/remplacement ; contenu et connexion effective non vérifiés. Aucun déploiement ni migration distante.

Validation après npm ci : **700/700 tests, 77 fichiers** (638,97 s), lint 0 erreur/avertissement sur 281 fichiers, build/schema/diff OK, avertissement bundle existant. db:check local missing_configuration : ne pas prétendre un raccordement local opérationnel. Rapport [03J_OFFICIAL_DATABASE_TARGET.md](docs/marketplace/03J_OFFICIAL_DATABASE_TARGET.md). Restauration hébergée non prouvée, migrations 006–021 toujours en attente ; No-Go maintenu.

## Marketplace — tranche 03K : diagnostic de préparation des migrations (1er novembre 2026)

Reprise : nouveau contrôle distant en lecture seule confirme registre 001–005, 28 tables salon_pro et 19 public. Ajout de `npm run db:migrations:plan` : inventaire cohérent REPEATABLE READ READ ONLY, registre privé qualifié, comparaison aux migrations connues, conflits/erreurs redigés, verrou officiel requis au CLI si connexion fournie. Aucune autorisation de migration ou restauration déduite ; aucun SQL d’écriture.

Validation **706/706 tests, 78 fichiers** (623,92 s), lint sans erreur/avertissement sur 284 fichiers, build/schema/diff réussis. Commande locale exécutée : missing_configuration ; ne pas confondre catalogue candidat avec registre distant. Rapport [03K_MIGRATION_PLAN.md](docs/marketplace/03K_MIGRATION_PLAN.md). Aucun déploiement/migration distante. Restauration réelle toujours non prouvée et publication fermée, No-Go maintenu.

## Marketplace — PROMPT 03, tranche 03L : aperçu complet enregistré (1er novembre 2026)

Reprise des fonctionnalités selon le plan : panneau Gérant d’aperçu complet du profil enregistré, contacts, prestations sélectionnées/prix/durées ERP, semaine et exceptions, fuseau et version/instant. Endpoint privé POST /api/visibility/preview/read, session/origine/tenant/Gérant et rate limit existants ; snapshot REPEATABLE READ READ ONLY sous runtime. Garde verrouillant conservé par défaut pour commandes existantes, option interne sans FOR SHARE pour lecture snapshot. Exclusions privées explicites, source indisponible annoncée, aucun prix/durée fictif. Aperçu invalidé après sauvegardes locales et dépublication ; erreurs retirent la copie précédente, pas de cache métier local de remplacement.

Validation : **715/715 tests, 80 fichiers** (664,23 s), lint sans erreur/avertissement sur 289 fichiers, build/schema/diff OK. Neuf tests ajoutés API/PG/DTO/UI, lecture seule réellement exercée. Libellé publication corrigé (parcours incomplet, pas droits absents). Aucune migration nouvelle ou distante, aucun déploiement/provider/abonnement réel. Rapport [03L_COMPLETE_SAVED_PREVIEW.md](docs/marketplace/03L_COMPLETE_SAVED_PREVIEW.md). Prochaine tranche fonctionnelle : commande de publication/projection complète atomique puis médias sécurisés et portail ; pas de créneaux/réservation automatique inventés. Restauration distante non prouvée et No-Go maintenu.

## Marketplace — PROMPT 03, tranche 03M : publication textuelle atomique (1er novembre 2026)

Commande et UI Gérant de publication **sans photos**, confirmation et identifiant public explicites. Migration additive opt-in 022 : détails publics whitelisted + reçus privés immuables, fonction SECURITY DEFINER étroite sans grants d’écriture directs au runtime/browser. Copie atomique profil/contacts/prestations ERP sélectionnées/semaine/fuseau/exceptions sans notes privées, audit/version/révision/reçu et gate ouvert en fin de transaction jusqu’à grâce. Droit actif et quotas 021 revérifiés, sources verrouillées/relues ; aucune réservation automatique. Photos publiques existantes entraînent refus plutôt qu’effacement/héritage silencieux.

Rejeu tenant/acteur/clé/version/slug stable sans duplication ni résurrection après dépublication/révocation. UI conserve la même intention en mémoire après erreur ; limite de reprise après fermeture/rechargement documentée. Flag SALON_TEXT_PUBLICATION_ENABLED=false ; canPublish désormais calculé pour le parcours textuel, contrôles complets SQL toujours obligatoires. Aucun portail/photo prétendu opérationnel. Opt-in --include-text-publication implique 009/010/011/012/016/017/018/019/021, pas 020 ni finance/booking ; backup/restore requis.

Validation : **727/727 tests, 82 fichiers** (694,26 s), lint 0 erreur/avertissement sur 295 fichiers, build/schema/diff OK ; 12 tests supplémentaires PG/API/UI/DTO. Aucune migration distante, souscription ou publication réelle, activation de flag Vercel, déploiement/commit/push. Rapport [03M_ATOMIC_TEXT_PUBLICATION.md](docs/marketplace/03M_ATOMIC_TEXT_PUBLICATION.md). Restauration/recette hébergée et concurrence propre à 022 encore à valider ; médias sécurisés et portail/demandes restent à livrer. PROMPT 03 partiel et No-Go production maintenu.

## Marketplace — PROMPT 03, tranche 03N : traitement privé réel des médias (1er novembre 2026)

Suite médias sécurisés : sharp serveur ajouté, politique technique explicite sans défaut commercial, décodage réel JPEG/PNG/WebP en sous-processus annulable/tuable, flux bornés et maximum deux décodeurs par processus. Formats actifs/animations/troncatures/MIME trompeurs et limites refusés ; orientation normalisée, variante WebP redimensionnée, métadonnées EXIF/ICC/XMP retirées, hashes calculés sur les octets. Contrat de stockage privé worker + adaptateur mémoire de test tenant-bound/immuable/borné, refusé par la primitive en production, aucun fallback réseau ou bucket public.

Primitive privée awaitée processStoredMedia raccordée à 012/019/021 : verrou média, rôle worker tenant, pending→processing→ready avec variante/preuve/audit atomiques, rejet/expiration libérant le quota, rollback/compensation avant COMMIT et conservation d’objet si accusé COMMIT perdu. Aucun original/variante rendu public par ce traitement, aucun binaire PostgreSQL/Dexie/sync. Pas de migration nouvelle ni d’appel distant/secret/provider/flag/deployment modifié.

Validation : **742/742 tests, 84 fichiers** (719,00 s), lint sans erreur/avertissement sur 302 fichiers, build/schema/diff OK. Quinze tests réels décodeur/enfant Node, stockage de test et PGlite ; perte d’accusé simulée, pas de preuve hébergée. Rapport [03N_PRIVATE_MEDIA_PROCESSING.md](docs/marketplace/03N_PRIVATE_MEDIA_PROCESSING.md). Limites documentées : RSS natif/sandbox OS non imposés, job durable/retries/réconciliation/purge et fournisseur réel/signature d’upload/galerie/diffusion non livrés. Prochaines tranches : raccordement provider et cycle upload durable, puis portail public et recette hébergée. PROMPT 03 partiel et No-Go maintenu.
