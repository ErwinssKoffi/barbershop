# PROMPT 03C — Prestations et horaires dans l’éditeur Gérant

1er novembre 2026. React/TypeScript/Vite conservé. **Fonctionnalités de brouillon uniquement ; publication et photos toujours fermées.**

## Parcours livré

Une section « Prestations et horaires du brouillon » complète `/visibility`, réservée au Gérant :

- chargement explicite après création du profil ;
- sélection/désélection des prestations et variantes réellement disponibles dans le catalogue ERP du tenant ;
- libellés, prix XOF et durées lus/validés côté serveur, jamais acceptés comme autorité depuis le navigateur ; durée non renseignée affichée explicitement ;
- saisie de la semaine complète, avec plusieurs plages séparées par virgule, ex. `09:00-12:00,14:00-18:00` ; vide = fermé, fin à 24:00 autorisée, intervalles adjacents fusionnés et chevauchements refusés ;
- ajout, édition et retrait d’exceptions datées ; une exception remplace toute la journée, et une plage vide indique une fermeture exceptionnelle ;
- affichage du fuseau du salon, lu dans tenants, sans conversion implicite depuis le fuseau de l’appareil ;
- sauvegarde atomique, versionnée et auditée, avec relecture exigée après conflit/résultat incertain.

Les plages sont des minutes du calendrier local, pas des créneaux UTC réservables. Aucun horaire commercial prérempli ; une semaine sans données est présentée fermée. Les champs ont des valeurs vides, pas un jeu de démonstration.

La version est celle du profil, commune aux deux éditeurs. Après une sauvegarde prestations/horaires, le formulaire de profil est désactivé jusqu’à rechargement pour éviter une soumission de son ancienne version. Après une sauvegarde du profil, l’éditeur configuration doit être rechargé : sa soumission périmée est rejetée côté serveur. Les modifications locales non sauvegardées ne sont pas fusionnées automatiquement.

Une sélection devenue inactive/invalide reste identifiable dans l’éditeur lorsqu’elle existe encore, avec retrait explicite demandé avant sauvegarde. Une purge du catalogue cascade les brouillons et leur membership conformément à 011 ; aucun nom/prix fictif ne les remplace. Les métadonnées ERP invalides ne sont pas proposées ; les limites techniques empêchent une troncature silencieuse (500 offres/sélections, 366 exceptions). Ces bornes ne constituent pas des entitlements commerciaux.

## API et sécurité

- `POST /api/visibility/config/read`, objet vide.
- `POST /api/visibility/config/save`, expectedVersion + services + weekly + exceptions, champs inconnus refusés.
- Authentification/session vivante, Gérant actif, tenant actif, rate limit et garde d’origine identiques à 03A/03B ; acteur/tenant jamais choisis par le body.
- Contexte runtime/RLS, verrou advisory tenant-scoped partagé avec la sauvegarde du profil ; sauvegarde sous verrou de ligne du profil et lecture verrouillée des sources catalogue. Lecture de configuration sous le même verrou advisory pour ne pas mélanger deux sauvegardes API.
- Mise à jour du profil, des choix et des horaires avec événement draft_saved dans une seule transaction. Échec de l’audit = rollback de toute la sauvegarde.
- Réponses privées en allowlist et client rattaché à l’espace/session ; aucun coût, commission, consommable, contact client ou note privée d’exception exposé.
- Aucun appel public anonyme, endpoint d’upload ou modification des cookies.

Les événements existants indiquent acteur/version/instant de sauvegarde ; ils **ne contiennent pas un historique complet avant/après de chaque plage ou sélection**. Il ne faut pas les présenter comme un mécanisme de restauration de contenu. Les politiques SQL runtime protègent les tenants ; les permissions humaines sont relues par les commandes, pas dérivées d’un acteur fourni par le client.

## Données et protection des copies publiées

Les horaires réutilisent les tables privées de 010 : salon_opening_hours et schedule_exceptions. Les sélections réutilisent les brouillons de prestations 011, avec la nouvelle table privée de membership `salon_service_selections` (017).

**Désélectionner ne supprime pas salon_public_services** : ce serait un DELETE CASCADE vers la copie publiée. Seul le membership est retiré, les copies publiées restent intactes. Les brouillons non sélectionnés restent privés et pourront être nettoyés par une politique ultérieure contrôlée. Une future publication devra filtrer explicitement les memberships, pas publier tous les brouillons existants.

La migration 017 ajoute aussi une clé unique `(tenant_id,profile_id,id)` à salon_public_services pour une FK tenant/profil/prestation stricte. Membership ENABLE/FORCE RLS ; runtime SELECT/INSERT/DELETE du tenant seulement, aucun grant navigateur/public. Aucune seed ni backfill de sélections implicites.

Les copies publiques de profils/prestations/horaires ne sont ni réécrites ni supprimées par ces commandes. Aucune disponibilité, réservation, vente, commission ou mouvement de stock créé. `booking_requested` n’est pas activé par la sélection.

Les notes privées des exceptions **retenues** sont conservées par UPSERT, sans être lues dans le DTO. Retirer une exception supprime sa ligne, donc aussi une éventuelle note associée ; la commande représente un remplacement explicite de la liste des exceptions. Pas d’édition ou de récupération des notes privées dans cette interface. Une suppression de source ERP continue d’avoir ses effets de purge/invalidation déjà définis dans 011, indépendamment de cet éditeur.

## Activation et compatibilité

Opt-in `--include-visibility-editor`, soumis à `SALON_MARKETPLACE_BACKUP_VERIFIED=true` après backup/restore effectifs : implique **009 + 010 + 011 + 016 + 017**, pas 006/007/008 ni médias/outbox/blocs. Dépendances explicites dans le runner ; anciens opt-ins inchangés. Snapshot/SQL optionnel alignés, sources historiques 009–016 non réécrites.

`SALON_VISIBILITY_ENABLED` reste faux par défaut. Le profil 03B fonctionne avec 009+016 ; la nouvelle section requiert en plus 010/011/017. Sans elles, erreur explicite VISIBILITY_EDITOR_MIGRATION_REQUIRED, pas de création automatique de tables. Aucun profil → demande d’enregistrer d’abord le profil.

La configuration Cloud locale reste absente : parcours exercé via tests API/PostgreSQL/UI, **pas opérationnel contre une base hébergée dans ce sandbox**. Aucun DDL distant, secret, fournisseur, déploiement, commit ou push effectué. Preuves de backup/restore hébergé et recette des rôles/concurrence réels manquantes : production No-Go maintenu.

## Validation obtenue

- `npm run lint && npm test && npm run build` réussi.
- **642/642 tests, 68 fichiers**, 583,80 s ; début 10:18:34 UTC le 1er novembre 2026.
- 23 nouveaux tests : 8 API/SQL, 11 domaine/CLI, 3 UI et 1 registre. Catalogue/variantes, RLS/FK, versions partagées, rollback métier/DDL, copies publiées, notes conservées, exceptions, erreurs, validation et indépendance des migrations vérifiés.
- Lint : 256 fichiers, zéro avertissement/erreur.
- `db:schema:check`, `git diff --check`, hashes historiques 009–015 : réussis ; 016 non modifiée et export cohérent. Vérifications supplémentaires fichiers non suivis et liens documentaires.
- Avertissement de build persistant : chunk principal 618,04 kB, gzip 183,61 kB.
- `db:check` : code 1, missing_configuration, checkoutReady/refundsReady false.
- Aperçu Vite 4173 `/visibility` HTTP 200, sans prétendre une recette visuelle Cloud authentifiée.

PGlite ne prouve pas la concurrence réelle multi-connexion PostgreSQL ; les tests UI simulent le transport. Les plages ne sont pas raccordées à l’agenda et ne garantissent pas des disponibilités publiques, notamment DST, concurrence, pauses, droits ou quota.

## Repli et suite

Désactiver le flag pour arrêter le parcours, conserver toutes les données privées. Aucun DROP/purge automatique de repli. L’échec de 017 annule table et contrainte ajoutée sans retirer 011 préexistante ; testé. En repli logiciel vers 03B, les tables additives peuvent rester présentes. Une restauration hébergée n’est jamais présumée.

Avancement consigné dans `IMPLEMENTATION_PROGRESS.md`. **Publication et photos restent à raccorder sous droits explicites et stockage sécurisé**, conformément à la demande. PROMPT 03 reste partiel ; pas de simulation de publication, de média ou d’abonnement. Le portail et la réservation publique ne sont pas livrés dans cette tranche.
