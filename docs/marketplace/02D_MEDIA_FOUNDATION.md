# PROMPT 02D — Fondation des métadonnées médias

Date : 1er novembre 2026. Stack conservée : React / TypeScript / Vite. **Socle local validé, pas de service d’upload ni de diffusion. PROMPT 02 reste partiel ; production No-Go.**

## Implémentation

Migration additive optionnelle `012_marketplace_media`, dépendante de 009 seulement :

- `salon_media` : original privé, identité UUID, chemin opaque déterministe, MIME/octets déclarés, expiration et preuves mesurées. Cycle pending → processing → ready ou rejected/deleted ; aucune résurrection. Ready exige des preuves cohérentes et une variante non purgée.
- `salon_media_variants` : objets optimisés privés JPEG/PNG/WebP, dimensions/octets/digest, identité immuable. Création pendant processing seulement ; attestation de purge irréversible après fermeture du parent.
- `salon_public_media_projection` : sélection de variante, identifiant public distinct, usage logo/cover/gallery, ordre et textes. Dimensions/MIME dérivés de la variante ; originaux jamais projetés. Un seul logo/cover par profil. La diffusion reste conditionnée à ready, à l’absence de purge et à la visibilité du profil 009. Suppression logique ferme transactionnellement la projection ; forcer renderable ne contourne pas le contrôle.
- `salon_media_events` : journal transactionnel des créations/transitions d’état, ancien/nouvel état et rôle SQL appelant. Lecture tenant-scoped, aucun droit d’écriture runtime/worker ; UPDATE/DELETE bloqués par trigger. Le rôle SQL n’identifie pas l’utilisateur humain : l’audit applicatif authentifié reste à intégrer avec les futures commandes.

Toutes les tables sont ENABLE/FORCE RLS, avec références tenant-composites. Runtime : lecture de son tenant, création pending sans preuves, modification des textes/version seulement. Worker SQL dédié NOLOGIN/NOSUPERUSER/NOBYPASSRLS/NOINHERIT : métadonnées de traitement et variantes uniquement, pas de finance ni de publication. Rôle préexistant refusé. Lecteur public serveur : projection publique seulement, filtrée par la visibilité 009. Les grants navigateur hérités des defaults sont révoqués ; fonctions de trigger non exécutables par PUBLIC/anon/authenticated. Fonctions SECURITY DEFINER à search_path pg_catalog et tables qualifiées par schéma de trigger.

`src/domain/media.ts` fournit états, validations de limites explicites et preuves, chemins UUID et DTO public en allowlist. La détection de signature **n’est pas un décodage** : un fichier tronqué peut correspondre à une signature. Les preuves doivent provenir d’un futur traitement de confiance, jamais directement du visiteur. Les chemins ne sont ni une autorisation ni une signature d’upload. Le DTO ne contient ni tenant/profil privé, ni chemin/bucket/hash/original/URL signée. Le rôle lecteur SQL est strictement serveur, pas une interface destinée au navigateur.

## Activation et compatibilité

`--include-media` implique 009 + 012, sans 010/011, booking 008 ni finance 006/007. Le CLI exige `SALON_MARKETPLACE_BACKUP_VERIFIED=true` : c’est une déclaration opérateur, **pas une sauvegarde ou preuve de restauration**. Aucun opt-in existant n’active 012 implicitement. Registre, export optionnel et snapshot PostgreSQL sont alignés. Aucun seed métier ni changement du logo privé historique.

Aucune migration distante exécutée. Aucun secret, bucket, provider ou déploiement modifié. Aucune validation hébergée acquise dans ce lot.

## Validation obtenue

- Suite complète : **514/514 tests, 57 fichiers**, 422,72 s, début 08:44:22 UTC le 1er novembre 2026.
- Lint : 229 fichiers, zéro avertissement/erreur ; build TypeScript/Vite réussi.
- Avertissement non bloquant préexistant : chunk principal 613,89 kB (182,40 kB gzip).
- Tests médias : 11 SQL et 13 domaine/CLI, plus test d’opt-in registre. Isolation, FK inter-salons, permissions, transitions, preuves, variantes, publication/fermeture, visibilité, journal immuable, grants navigateur, idempotence et rollback DDL/rôle contrôlés.
- `db:schema:check`, `git diff --check` et SHA256 des sources/exports 009–011 : réussis.
- `db:check` : code 1, `missing_configuration`, checkoutReady/refundsReady false. Ce résultat n’atteste pas une connexion Supabase ni la recette de 009–012.
- PGlite est un PostgreSQL embarqué à session unique : ces tests ne prouvent pas la concurrence réelle multi-connexion ni les privilèges du compte hébergé.

## Non livré / conditions avant exploitation

Provider et limites commerciales non choisis ; pas de bucket, quota réservé, signature, intention d’upload, endpoint, décodage borné, réencodage/EXIF stripping, durable worker ou suppression d’objet. `purged_at` est une future attestation du worker, pas une preuve d’effacement physique. Le rôle SQL worker n’est pas un processus de traitement. Pas d’API/UI Gérant, publication authentifiée, droits/entitlements, cache/proxy HTTP no-store ni service de réservation publique. Voir [ADR-003_MEDIA_STORAGE.md](adr/ADR-003_MEDIA_STORAGE.md).

Avant activation : choisir et configurer le stockage privé, implémenter et recetter la chaîne de traitement, les quotas, permissions et jobs fiables ; vérifier backup/restore hébergé, rôles/RLS et concurrence sur PostgreSQL réel. Ne pas appliquer 012 sur la base hébergée sur la seule foi des tests locaux.

## Repli

En cas d’échec d’application, le runner annule transactionnellement DDL et création du rôle de 012 sans retirer 009 ; testé. Après une application réussie, arrêter les producteurs/consommateurs futurs, fermer la diffusion et conserver les métadonnées/journaux privés. Ne pas supprimer les tables, événements ou objets comme mécanisme automatique de rollback. Une restauration hébergée doit être préparée et prouvée avant activation ; aucun script destructif livré. Les modules ERP existants restent utilisables sans cet opt-in.
