# PROMPT 03B — Champs complémentaires du profil public en brouillon

1er novembre 2026. Suite fonctionnelle de [03A](03A_VISIBILITY_DRAFT.md), React/TypeScript/Vite conservé. **PROMPT 03 toujours partiel, aucune publication activée.**

## Fonctionnalités raccordées

Le Gérant peut saisir, charger, modifier, prévisualiser et enregistrer :

- slogan ;
- catégorie du salon (texte libre, sans taxonomie métier inventée) ;
- adresse destinée à une future publication ;
- numéro WhatsApp international ;
- email public ;
- site web HTTPS ;
- liens Facebook, Instagram et TikTok.

Les champs sont facultatifs et vierges à la création. Aucun contact privé n’est copié automatiquement. L’aperçu les affiche comme texte React, sans HTML brut, lien actif ou chargement réseau d’une ressource tierce. Le formulaire rappelle de n’y inscrire que les coordonnées destinées à être publiques ultérieurement ; elles restent privées dans ce lot.

Les mêmes commandes POST `/api/visibility/read` et `/api/visibility/save` gèrent les détails sous `details`. Acteur/tenant restent issus de la session, Gérant actif vérifié en transaction. Même garde d’origine/rate limit/Cache-Control no-store que 03A ; pas de nouvelle route anonyme.

Une sauvegarde modifie profil de base et détails dans la même transaction, avec la **version commune du profil** et un événement draft_saved. Un conflit n’écrit rien ; l’échec de l’audit annule profil et détails. Les réponses d’un ancien espace ne sont pas affichées. La reprise après erreur impose toujours une relecture.

Compatibilité du contrat : `details` omis dans une commande ancienne conserve les valeurs existantes ; `details` présent doit contenir tous les champs connus valides. Effacement explicite par chaînes vides. Aucune clé arbitraire supplémentaire, tenant, acteur ou identifiant SQL n’est accepté dans ces champs. Le formulaire extrait ses champs éditables au chargement pour ne pas renvoyer id/tenantId/version comme données éditables.

## Validation

`src/domain/profileDetails.ts` fournit types, valeurs vierges et validation partagée serveur/client :

- limites de longueur, absence de caractères de contrôle et champs inconnus refusés ; champs complémentaires sur une seule ligne ;
- WhatsApp au format international `+` et 7–15 chiffres, pas d’ouverture de session ou d’envoi ;
- format d’email basique borné, sans prétendre vérifier l’existence de la boîte ;
- URL HTTPS explicite, sans identifiants, port non standard, espace ou antislash, normalisée avec URL ;
- domaine exact facebook.com/www.facebook.com, instagram.com/www.instagram.com ou tiktok.com/www.tiktok.com pour les champs dédiés, pas les suffixes trompeurs.

Aucun lien n’est contacté par le serveur. La validation n’atteste ni propriété, ni réputation, ni accessibilité d’un site et ne constitue pas un mécanisme anti-SSRF pour un futur fetch. Le site général peut désigner un hôte non public : **ne pas réutiliser cette validation pour un proxy, screenshot, scraping ou import distant**. Le futur portail devra traiter les liens sortants avec sa politique propre, sans fuite de session/referrer. Aucun téléphone/email n’est vérifié auprès d’un fournisseur.

## Migration 016 et sécurité

`016_profile_details` ajoute `salon_profile_details`, privée, en relation 1:1 avec le profil 009. FK `(tenant_id,profile_id)`, PK composite et unicité du tenant ; ENABLE/FORCE RLS. Runtime SELECT/INSERT/UPDATE de son tenant seulement, aucun DELETE. Aucun accès PUBLIC/anon/authenticated ni rôle lecteur public 009. Les grants navigateur par défaut sont révoqués.

Les contraintes SQL bornent les champs/URLs et le format WhatsApp. La validation sémantique complète des URLs/emails appartient au service partagé ; un administrateur SQL privilégié peut toujours écrire une valeur non validée par l’API. Les tables ne sont pas une projection publique et leur contenu ne doit jamais être sérialisé brut au visiteur.

Opt-in séparé `--include-profile-details` : implique **009 + 016 uniquement**, pas horaires/catalogue/media/booking/finance. Le CLI exige `SALON_MARKETPLACE_BACKUP_VERIFIED=true`, déclaration opérateur après sauvegarde/restauration réellement vérifiées, pas une preuve ou opération de sauvegarde. Aucun ancien opt-in n’applique 016 implicitement. Snapshot et export optionnel alignés ; sources/exports 009–015 non réécrits.

Pas de seed ou backfill : les profils anciens sans ligne détails sont lus avec des champs vierges. La ligne est créée à la première sauvegarde explicite de details. Les profils et événements existants sont conservés.

## Activation / repli

Le serveur de cette version exige **009 et 016** pour le parcours Visibilité. Sans 016 il répond VISIBILITY_DETAILS_MIGRATION_REQUIRED, message explicite dans le client. `SALON_VISIBILITY_ENABLED` reste faux par défaut. Le flag ne réalise aucune migration ; aucune modification distante effectuée.

Avant activation : backup/restore hébergés prouvés, migration 016 sur environnement de recette et validation des rôles réels, puis flag serveur de recette. Une installation 03A avec 009 seulement ne doit pas activer cette version avant la migration approuvée. En repli, désactiver le flag et conserver les données. Le code précédent ignore la table additive, sans nécessité de DROP. L’échec d’application 016 annule sa DDL sans retirer 009 préexistante ; testé.

La configuration Cloud locale reste absente : **le parcours est validé par tests, pas opérationnel contre une base hébergée dans ce sandbox**. Pas de recette utilisateur authentifiée sous HTTPS ni de preuve de restauration hébergée ; production No-Go maintenu.

## Preuves obtenues

- `npm run lint && npm test && npm run build` : succès.
- **619/619 tests, 65 fichiers**, 526,26 s ; début 10:03:55 UTC le 1er novembre 2026.
- 28 tests ajoutés par rapport à 03A : 5 intégration profil/détails + 1 rollback DDL, 20 validations pures, 1 registre et 1 UI. Compatibilité d’omission, effacement, FK/RLS, accès navigateur/public, rollback de l’audit, erreurs de migration, HTTPS/contacts et sauvegarde UI sans identifiants SQL testés. Les 6 tests API 03A sont réexécutés avec 016.
- Lint 249 fichiers, zéro avertissement/erreur.
- Schéma généré/diff/hashes 009–015 : réussis. Contrôles supplémentaires newlines/espaces et liens documentaires.
- Build : avertissement de taille persistant, chunk principal 618,04 kB, gzip 183,61 kB.
- `db:check` : code 1, missing_configuration, checkoutReady/refundsReady false.
- `/visibility` en aperçu Vite 4173 : HTTP 200. Pas de capture visuelle ou recette Cloud authentifiée prétendue.

PGlite ne prouve pas la concurrence réelle multi-connexion PostgreSQL ; les tests UI simulent le transport. Aucune modification du moteur financier/booking ou des packages dans ce lot. Aucun secret, fournisseur, déploiement, commit/push ou DDL distant.

## Suite du plan et avancement

Avancées consignées dans `IMPLEMENTATION_PROGRESS.md`. Prochaine tranche fonctionnelle : sélection des prestations authentiques et gestion des horaires depuis cet éditeur, avec versionnement/permissions/audit, puis publication sous autorité de droits explicites et chaîne média sécurisée. Aucun de ces éléments n’est annoncé terminé ici. Souscriptions/droits commerciaux restent à spécifier selon [ADR-005](adr/ADR-005_ENTITLEMENTS.md). Pas de galerie fictive, upload simulé ou prix/entitlement par défaut.
