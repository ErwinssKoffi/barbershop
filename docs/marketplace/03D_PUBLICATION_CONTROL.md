# PROMPT 03D — État de visibilité et dépublication sécurisée

1er novembre 2026. React/TypeScript/Vite conservé. **Mise en ligne et photos toujours non activées ; PROMPT 03 partiel.**

## Parcours Gérant livré

La page `/visibility` comporte maintenant un panneau de contrôle :

- lecture explicite de l’état de visibilité d’après le gate serveur 009, sa période et l’existence de la projection ;
- version du brouillon et révision de la copie publiée affichées séparément, sans supposer qu’elles soient comparables ;
- checklist **préliminaire** : profil absent, nom public ou ville manquants, et blocage permanent explicite tant que l’autorité serveur des droits n’est pas raccordée ;
- bouton Publier toujours désactivé ; aucun endpoint de publication ajouté ;
- confirmation obligatoire avant dépublication d’un gate portant encore published=true, y compris si sa période est déjà expirée ;
- relecture après dépublication, invalidation de l’éditeur de profil et demande de recharger les éditeurs avant de modifier ;
- en cas d’erreur/résultat incertain : état local supprimé, action désactivée jusqu’à nouvelle lecture, pas de succès fictif.

La checklist n’est pas une validation complète des offres, médias, horaires, entitlements ou droits commerciaux. Une fiche non visible peut être expirée, non publiée, sans période valide ou sans projection ; le panneau ne fournit pas encore une classification exhaustive de ces causes. La présence d’une ancienne copie en DB ne signifie pas qu’elle est accessible publiquement.

## API et autorisations

`POST /api/visibility/publication/read` et `POST /api/visibility/publication/unpublish` (expectedVersion uniquement). Même authentification Bearer/session vivante, tenant actif, Gérant, contrôle d’origine et rate limit que les commandes Visibilité existantes. Tenant et acteur exclusivement issus de la session, jamais du body. Réponses privées no-store et validation du DTO client ; impossible d’activer Publier en injectant canPublish=true dans une réponse attendue.

Dépublier ne demande pas de droit commercial de publication. Cela ne dispense pas de l’accès Gérant/tenant actif ni du flag opérateur SALON_VISIBILITY_ENABLED. La suspension de sécurité et la désactivation du module restent prioritaires. Aucun abonnement ou paiement supposé, aucun rôle plateforme ou compte système fictif.

## Migration additive 018

`018_visibility_unpublish` ajoute une fonction SQL étroite `unpublish_salon_profile(TEXT,INTEGER)` :

1. tenant lu dans le contexte transactionnel ; membership Gérant, utilisateur et tenant actifs vérifiés ;
2. verrou advisory partagé avec les commandes profil/configuration, schéma correctement littéralisé et tables qualifiées ;
3. verrou de ligne profil/gate et version attendue vérifiée ;
4. published=false uniquement, sans droit de le remettre à true ;
5. version de profil incrémentée et événement unpublished dans la même transaction ;
6. si déjà non publié, aucune mutation/événement/version supplémentaire ; une version périmée reste refusée.

Fonction SECURITY DEFINER à search_path pg_catalog, schéma des tables fixé à l’installation, EXECUTE révoqué à PUBLIC/anon/authenticated et accordé au seul rôle runtime serveur. **Aucun UPDATE direct sur le gate accordé au runtime.** Le rôle runtime reste une capacité serveur de confiance : la commande doit fournir l’acteur de session vérifié ; cette fonction n’authentifie pas un utilisateur navigateur à partir du seul identifiant p_actor.

Pas de nouvelles tables ou politiques exposant des données privées. Les tables existantes restent FORCE RLS ; la fonction vérifie explicitement tenant et acteur avant son opération privilégiée. Les capacités effectives du propriétaire de fonction en environnement hébergé doivent être recettées, pas déduites des tests embarqués.

Un échec de l’audit annule fermeture et version. La copie publiée, les détails du brouillon et les éventuelles métadonnées médias privées sont conservés. Les projections publiques existantes dépendent du gate 009 : leur lecture est fermée transactionnellement. Pas d’effacement de rendez-vous, finance ou stock. Les octets d’une image déjà téléchargée ne peuvent pas être retirés du navigateur par cette opération.

## Activation et cache

Opt-in `--include-visibility-unpublish`, exigeant SALON_MARKETPLACE_BACKUP_VERIFIED=true après backup/restore réellement vérifiés. Dépendance **009 + 018 seulement** ; aucun ancien opt-in n’active 018. Le parcours web réutilise le garde 03B, donc exige aussi 016 et le flag SALON_VISIBILITY_ENABLED=true. 017 n’est pas requise pour dépublier.

Sans 018, erreur explicite VISIBILITY_UNPUBLISH_MIGRATION_REQUIRED ; pas de migration automatique. Aucun DDL distant ou activation de flag effectués. Configuration Cloud locale absente : parcours exercé en tests, pas opérationnel contre une base hébergée dans le sandbox.

Le handler privé émet no-store. Aucun portail public, cache public/CDN, service de diffusion média ou worker d’invalidation n’est créé ici. La fermeture est testée à travers les politiques de lecture DB ; ne pas prétendre invalider un cache HTTP qui n’a pas encore été implémenté. Le futur portail/média devra consulter le gate et appliquer sa politique de cache/invalidation avant chaque diffusion appropriée.

## Preuves locales

- **653/653 tests, 70 fichiers**, 598,74 s ; début 10:35:30 UTC le 1er novembre 2026.
- 11 nouveaux tests : 6 SQL/API, 2 UI, 1 DTO, 1 CLI, 1 registre. Gate/expiration, lecture publique avant/après, no-op, conflit, acteur Caissier/inter-tenant, grants navigateur, rollback d’audit/DDL, confirmation UI et publication fermée vérifiés.
- `npm run lint && npm test && npm run build` réussi. Lint 262 fichiers, zéro avertissement/erreur.
- `db:schema:check`, `git diff --check`, hashes historiques 009–016 disponibles : réussis ; source/export 017 non modifiés.
- Chunk principal : 618,04 kB, gzip 183,62 kB, avertissement >500 kB persistant et non bloquant.
- `db:check` : code 1, missing_configuration, checkoutReady/refundsReady false.
- Aperçu Vite 4173 `/visibility` HTTP 200 ; aucune recette navigateur authentifiée sous HTTPS ni capture visuelle automatisée prétendue.

PGlite ne prouve pas la concurrence réelle multi-connexion PostgreSQL. Les tests UI simulent le transport. Aucun secret/provider, migration distante, déploiement, commit/push ou changement du moteur financier/booking/packages dans ce lot.

## Repli et suite

Échec d’application : fonction et registre 018 annulés transactionnellement, 009 préexistante conservée ; testé. Après application réussie, désactiver le flag pour arrêter les commandes, conserver tables, copies et événements. Pas de DROP/purge automatique de repli. Un retour logiciel ne doit jamais republier automatiquement un gate fermé.

Avancées consignées dans IMPLEMENTATION_PROGRESS.md. La prochaine étape permettant réellement **publier** requiert l’autorité serveur des droits explicites et la politique de période/activation, selon [ADR-005](adr/ADR-005_ENTITLEMENTS.md), puis la projection complète du brouillon et les contrôles de publication. Les photos exigent le stockage et le traitement sécurisé selon [ADR-003](adr/ADR-003_MEDIA_STORAGE.md). Aucun plan payé, quota commercial, fournisseur ou média opérationnel simulé. Backup/restore hébergés non prouvés : No-Go production maintenu.
