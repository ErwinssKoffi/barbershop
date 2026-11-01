# PROMPT 02E — Outbox de notifications, fondation locale

1er novembre 2026. **PROMPT 02 reste partiel. Production No-Go.** React/TypeScript/Vite conservé ; aucun nouveau service déployé.

## Livré

Migration additive volontaire `013_notification_outbox`, indépendante de 006–012 :

- `notification_outbox` : tenant, UUID de déduplication, référence opaque de ressource, type confirmation/rappel/annulation et canal email/SMS/WhatsApp. Métadonnées uniquement : ni destinataire, texte de message, URL, secret ou capacité de suivi.
- États pending/processing/sent/dead/cancelled ; enveloppe immuable, nombre de tentatives borné explicitement, disponibilité/expiration explicites, bail temporaire avec jeton UUID. Aucun quota/délai commercial prérempli.
- `notification_outbox_events` : création/transitions transactionnelles avec tentative et rôle SQL, journal sans UPDATE/DELETE. Ce rôle ne constitue pas une identité humaine authentifiée.
- ENABLE/FORCE RLS sur les deux tables, FK composite du journal vers son parent, unicité de déduplication par tenant et index tenant-scoped des tâches dues/baux.
- Runtime limité à la lecture de son tenant. Pas de création de notification par le navigateur ou une commande runtime arbitraire. Le futur producteur doit être un chemin serveur autorisé et transactionnel.
- Rôle worker SQL dédié NOLOGIN/NOSUPERUSER/NOBYPASSRLS/NOINHERIT : lecture de son tenant et mise à jour des champs de traitement seulement ; aucun INSERT/DELETE, aucune finance/publication. Rôle préexistant refusé. Defaults navigateur révoqués, fonctions de trigger non exécutables par PUBLIC/anon/authenticated.

`server/notificationOutbox.ts` fournit des primitives internes, non exposées en HTTP :

1. `claimNotifications` : lot borné, verrou `FOR UPDATE SKIP LOCKED`, tentative incrémentée, jeton neuf et bail limité à l’expiration.
2. `settleNotification` : complétion sent/dead ou retry à date explicite, conditionnée à l’identité, au tenant, au jeton courant et au bail non expiré. Zéro résultat signifie refus/état périmé, pas succès d’envoi.
3. `recoverExpiredNotifications` : récupération bornée des baux expirés vers pending si éligible, sinon dead ; expiration des tâches pending périmées. Ancien jeton inutilisable après récupération/reprise.

Chaque primitive utilise une transaction avec vérification du tenant actif via le contexte runtime, puis changement vers le rôle worker. Ce sont des appels serveur de confiance, pas une autorisation accessible au visiteur. Les bornes techniques sont 100 tâches par lot et 3600 secondes par bail, sans valeur par défaut. L’orchestration, la configuration et la politique de reprise restent à définir.

## Limites et sûreté de livraison

**Aucun SMS, WhatsApp ou email envoyé.** Aucun fournisseur, scheduler, processus worker durable, endpoint ou cron enregistré. Aucun producteur métier raccordé ; les réservations existantes ne génèrent pas encore de notifications. La référence `resource_id` n’a volontairement pas de FK vers un modèle futur de réservation : elle n’atteste ni existence, ni consentement, ni autorisation. Le futur producteur/handler doit résoudre et vérifier la ressource avec tenant, état courant, canal et consentement avant tout envoi.

La déduplication d’enveloppe n’est pas une garantie exactly-once chez un fournisseur. Après acceptation distante et crash avant acknowledgement DB, un nouvel essai pourrait dupliquer l’envoi. Il faudra une clé idempotente fournisseur, des reçus vérifiables et un rapprochement, ainsi qu’une politique pour les baux périmés, annulations concurrentes et rappels devenus caducs. `sent` est actuellement une attestation d’un futur worker de confiance, pas une preuve d’envoi réel. Le worker peut changer les champs autorisés : le fencing est assuré par les primitives serveur, pas une protection contre un worker SQL compromis.

Les comptes suspendus ne lancent pas les primitives ; les tâches correspondantes restent privées, sans traitement automatique de rétention/purge. La rétention du journal, la protection/résolution des destinataires et la gestion des capacités de suivi restent à concevoir avant exploitation. Rien de ce lot ne doit permettre de conserver des secrets de notification dans les logs.

## Activation et non-régression

Opt-in `--include-notifications`, exigeant `SALON_MARKETPLACE_BACKUP_VERIFIED=true`. Cette variable est une déclaration d’approbation, pas une opération de sauvegarde ni une preuve de restauration. Contrairement aux opt-ins catalogue/médias/horaires, 013 n’implique pas 009. Aucun ancien opt-in n’applique 013. Sources et exports 009–012 inchangés par SHA256. Registre, SQL optionnel et snapshot généré alignés ; booking/finance/API/packages inchangés dans ce lot.

Aucun seed métier, migration distante, secret, modification de provider ou déploiement. La configuration cloud locale reste absente. Les vérifications de backup/restore hébergé et rôles réels manquent : **ne pas activer en production**.

## Preuves locales

- `npm run lint && npm test && npm run build` : succès. Lint 232 fichiers, zéro avertissement/erreur.
- **525/525 tests, 58 fichiers**, 436,28 s ; début 08:55:36 UTC le 1er novembre 2026.
- 10 tests SQL outbox et 1 test registre ajoutés : isolation, déduplication, permissions/RLS/grants, cycle, retry valide/plafond, token périmé après récupération et nouvelle tentative, expiration, journal immuable, suspension, rollback DDL/rôle et idempotence.
- `db:schema:check`, `git diff --check`, hashes 009–012 : réussis.
- Build : avertissement préexistant non bloquant de chunk 613,89 kB (182,40 kB gzip).
- `db:check` : code 1, `missing_configuration`, checkoutReady/refundsReady false. Aucun diagnostic hébergé prêt obtenu.
- Aperçu Vite 4173 : HTTP 200 ; pas de recette visuelle d’un module notification, puisqu’aucune interface n’est livrée.

PGlite vérifie SQL/RLS et les reprises séquentielles, **pas la concurrence réelle de plusieurs connexions PostgreSQL**. SKIP LOCKED et l’idempotence fournisseur devront être recettés sur l’environnement hébergé avec pannes contrôlées.

## Repli

L’échec d’application annule transactionnellement DDL, rôle et registre 013 ; testé. Après une application réussie : ne pas démarrer les futurs producteurs/consommateurs, préserver tâches et journaux privés, ne pas purger automatiquement comme mécanisme de rollback. Aucun script destructif livré. Sauvegarde/restauration hébergées à prouver avant activation. L’ERP fonctionne sans cet opt-in.
