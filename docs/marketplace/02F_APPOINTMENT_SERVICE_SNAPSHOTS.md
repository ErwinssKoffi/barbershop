# PROMPT 02F — Instantanés historiques des prestations de rendez-vous

1er novembre 2026. **Fondation locale uniquement. PROMPT 02 partiel ; production No-Go.** Stack React/TypeScript/Vite inchangée.

## Migration additive 014

`014_appointment_services` ajoute `appointment_services`, attachée à `bookings` existant plutôt que de dupliquer l’agenda dans une seconde table appointments. Dépendance : 008 uniquement ; ni finance 006/007 ni Marketplace 009–013 activés implicitement.

Chaque ligne conserve tenant, rendez-vous, position, identifiants historiques de prestation/variante, date source, nom, libellé, prix entier XOF, durée, acteur et instant de capture. PK `(tenant_id,booking_id,position)`, FK composites vers rendez-vous et membership, index tenant/source. Limite technique de 100 positions ; aucun quota commercial inventé. Durée 5–480 minutes cohérente avec le périmètre actuel de l’agenda.

Le trigger d’insertion :

1. verrouille le rendez-vous du même tenant (FOR UPDATE), exige planned et kind appointment ; aucune capture sur une pause ;
2. vérifie acteur Gérant actif, compte actif et tenant actif ;
3. lit/verrouille la prestation authentique du même tenant (FOR SHARE), exige active côté colonne et payload ;
4. dérive nom, prix de référence depuis la colonne catalogue, variante unique et son prix, durée explicite de variante ou à défaut durée de base ;
5. refuse durée absente/fractionnaire/hors bornes, prix négatif/fractionnaire/hors entier sûr, variante inconnue/ambiguë ou libellé invalide ;
6. remplace les champs dérivés fournis par l’appelant et fixe captured_at à l’instant transactionnel.

Les lignes sont immuables (UPDATE/DELETE rejetés même via le propriétaire ordinaire des tables). Elles constituent aussi la trace append-only de capture avec acteur/instant, sans nouveau journal redondant. Aucun destinataire, contact, note privée de client, paiement ou capacité de suivi ajouté.

La source n’est **pas** une FK historique : son appartenance est validée lors de la capture, avec requêtes tenant-scoped. Cela permet de purger le catalogue sans supprimer ni empêcher la conservation de la trace d’un rendez-vous réel. Les identifiants conservés deviennent alors des références historiques, pas des pointeurs garantis vers une prestation actuelle. Les FK tenant-composites du parent et de l’acteur restent strictes.

## RLS et exposition

ENABLE/FORCE RLS. Runtime : SELECT de son tenant seulement, aucun INSERT/UPDATE/DELETE. Tables/fonctions sans accès PUBLIC/anon/authenticated, y compris après grants navigateur par défaut. Fonctions invoker à search_path pg_catalog, références qualifiées par schéma du trigger ; pas de fonction SECURITY DEFINER nouvelle.

Aucun chemin de production ne peut encore écrire ces lignes sous le rôle runtime. L’insertion privilégiée est réservée aux tests et à une future commande serveur précisément autorisée, à concevoir sans accorder des droits globaux de migration au navigateur. L’acteur n’est pas déduit d’un body HTTP : la future commande devra utiliser la session vérifiée et les permissions serveur. Aucun utilisateur système fictif créé.

`src/domain/appointmentServices.ts` fournit DTO **privé** en allowlist et total historique avec addition BigInt, contrôle d’overflow, positions distinctes et durée cumulée ≤480 minutes. Ce n’est pas un devis de caisse ni un DTO public. La conversion des BIGINT SQL (chaînes avec node-postgres) vers nombres sûrs devra être explicite dans le futur adaptateur ; aucune sérialisation brute de ligne SQL ne doit être exposée.

## Activation et compatibilité

Opt-in indépendant `--include-appointment-services` : le CLI exige **les deux** approbations `SALON_MARKETPLACE_BACKUP_VERIFIED=true` et `SALON_BOOKING_BACKUP_VERIFIED=true`, après sauvegarde/restauration effectivement vérifiées. Ces variables ne réalisent pas la sauvegarde et n’en sont pas une preuve. Les appels programmatiques du runner suivent la convention existante d’outil de migration de confiance ; le garde opérateur appartient au CLI.

008 et 009–013, sources et exports, conservent leurs SHA256. Aucun backfill : on ne peut pas reconstituer rétrospectivement un prix/durée historique authentique depuis un catalogue modifié. L’agenda actuel reste inchangé et fonctionne sans 014. Aucun effet de capture sur revenus, stock ou caisse. Les modifications/purges du catalogue continuent légitimement d’affecter la révision de synchronisation existante.

## Ce qui reste à implémenter

- Aucun raccordement à createBooking, aucun formulaire, endpoint, choix multi-prestations ou réservation publique livré ici.
- La table est immuable ligne par ligne, **pas un panier global scellé** : un futur producteur privilégié pourrait ajouter une position tant que le parent est planned. La future commande devra capturer toutes les lignes atomiquement, imposer la complétude, contrôler doublons métier, durée cumulée, correspondance avec l’intervalle et règles de modification/revision.
- Le contrôle de durée cumulée est dans le domaine, pas une contrainte agrégée PostgreSQL. La table ne prouve pas à elle seule qu’un rendez-vous a une capture complète ou que son intervalle correspond à cette durée.
- Aucun lien automatique vers publication, disponibilités, entitlements, notifications ou encaissement.
- Concurrence réelle multi-connexion, verrouillage et stratégie de reprise de la future commande à recetter sur PostgreSQL hébergé. PGlite vérifie les cas SQL/séquentiels, pas la concurrence hébergée.

## Validation locale obtenue

- **549/549 tests, 60 fichiers**, 451,35 s ; début 09:08:59 UTC le 1er novembre 2026.
- Ajout de 8 tests SQL, 15 domaine/CLI et 1 registre. Isolation/FK, source inter-tenant, acteur inactif/Caissier, valeurs dérivées, variante, immutabilité, purge, absence d’effet financier, grants, rollback et opt-in vérifiés.
- `npm run lint && npm test && npm run build` réussi ; lint 236 fichiers, zéro avertissement/erreur.
- `db:schema:check`, `git diff --check`, hashes 008–013 réussis. Vérification complémentaire des espaces/newlines des fichiers non suivis et des liens documentaires.
- Avertissement de build préexistant : chunk principal 613,89 kB, gzip 182,40 kB ; non bloquant.
- `db:check` : code 1, missing_configuration, checkoutReady/refundsReady false. Aucune connexion/recette hébergée prouvée.
- Preview Vite 4173 HTTP 200 ; aucune nouvelle interface à recetter visuellement.

Aucun DDL distant, seed métier, secret, provider, commit/push ou déploiement effectué dans ce lot.

## Repli

L’échec de 014 annule transactionnellement sa DDL sans retirer 008 déjà appliquée ; testé. Après application réussie, ne pas connecter le futur producteur et conserver les lignes privées. Aucun DROP/purge automatique comme rollback. Backup/restore hébergés à prouver avant activation ; absence de cette preuve = No-Go maintenu.

## État global de PROMPT 02

| Périmètre | État local |
| --- | --- |
| Profils et projection privée/publique | Socle 009, rapport [02A](02_DATA_FOUNDATION.md) |
| Horaires et exceptions | Socle 010, rapport [02B](02B_SCHEDULING_FOUNDATION.md) |
| Catalogue public et règles | Socle 011, rapport [02C](02C_PUBLIC_CATALOG.md) |
| Métadonnées médias | Socle 012, rapport [02D](02D_MEDIA_FOUNDATION.md) |
| Outbox | Socle 013, rapport [02E](02E_NOTIFICATION_OUTBOX.md) |
| Agenda interne et captures de prestations | 008 + 014 ; réservation publique et acteur public distinct non résolus |
| Blocs multijours dédiés, politique de concurrence publique | Reste à spécifier/implémenter sans casser les pauses internes 008 |
| Plans/droits/souscriptions/événements | Non implémentés ; transitions/effets commerciaux à approuver selon [ADR-005](adr/ADR-005_ENTITLEMENTS.md) |
| Recette PostgreSQL hébergé / backup-restore | Non prouvée, bloque l’activation distante |

Ces fondations ne constituent pas la livraison de PROMPT 03 (interfaces/publication), du stockage sécurisé ou de PROMPT 05 (réservation publique).
