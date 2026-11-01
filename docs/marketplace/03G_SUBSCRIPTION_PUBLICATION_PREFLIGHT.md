# 03G — Droits serveur dans le contrôle préliminaire de publication

1er novembre 2026 — tranche locale validée, publication toujours fermée.

## Implémentation

- Ajout de `server/subscriptionAccess.ts` : résolution commune depuis PostgreSQL dans le contexte transactionnel tenant. Horloge DB, tenant actif relu, filtrage explicite tenant en plus de RLS ; aucune date ni capacité reçue du navigateur.
- La consultation Gérant et le contrôle préliminaire de publication partagent désormais cette résolution. Les règles actif/grâce/expiré/révoqué restent celles approuvées en 03E.
- Le panneau de publication reçoit des blocages explicites si 019 manque ou si aucun droit actif n’autorise la publication. Une période de grâce ne permet pas une nouvelle publication.
- Avec un droit actif, vérification de la présence de 017 puis comptage des sélections tenant et comparaison au quota `publicServices` (10 ESSENTIEL ; zéro si serviceListing interdit). Les brouillons ne sont pas supprimés ou bridés ; le contrôle signale un dépassement avant publication.
- La dépublication reste possible sans abonnement et préserve les brouillons. Aucun changement de caisse, employés, comptes ou rendez-vous.

Le blocage technique `PUBLICATION_PIPELINE_INCOMPLETE` remplace l’ancien message « droits non raccordés ». Il demeure toujours présent : `canPublish` reste false, même avec abonnement actif et sélection sous quota.

## Frontière de sécurité

Ceci est un **précontrôle serveur en lecture**, pas une implémentation complète d’enforcement. Aucun endpoint publish ajouté, aucune ouverture de gate 009. Le quota est vérifié pour informer le panneau : il faudra le revérifier/verrouiller atomiquement dans la future transaction de publication. L’édition du brouillon reste disponible sans abonnement afin de conserver le travail existant.

La visibilité actuellement constatée dans le panneau reste celle du gate existant, distincte du droit de republier ; aucun masquage effectif à expiration ajouté dans cette tranche. Ne pas présenter ce contrôle comme une fermeture automatique des profils publics.

Restent : autorité SQL de publication/gate, projection complète, quotas atomiques sur commandes concernées, médias sécurisés, révocation/expiration effectives sur lecture publique, demandes publiques et recette hébergée. Pas de migration nouvelle nécessaire ; les opt-ins 019/017 existants restent manuels. Aucun DDL distant, activation réelle, déploiement, commit ou push effectué. **No-Go production maintenu.**

## Validation

- Lint : 0 avertissement/erreur sur 276 fichiers.
- Tests : **689/689, 75 fichiers**, 588,01 s.
- Build : réussi ; avertissement de bundle existant 618,04 kB (gzip 183,62 kB).
- Tests de régression réexécutés ; ajouts couvrant droits absents/migration absente, dépublication sans droit, conservation du brouillon, relecture après révocation et refus cross-tenant.
- La branche de comptage du quota ne constitue pas une preuve de concurrence/écriture atomique ; recette de publication et essais de seuil/transactions restent requis avant toute ouverture.
