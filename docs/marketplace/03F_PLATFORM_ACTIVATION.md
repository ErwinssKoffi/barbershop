# 03F — Activation manuelle privée ESSENTIEL

Date : 1er novembre 2026. Implémentation locale validée ; activation hébergée non réalisée. Production **No-Go**.

## Fonctionnalité livrée

Un opérateur plateforme peut préparer puis exécuter une activation ESSENTIEL à 4 900 XOF après vérification externe réelle. La commande est privée, hors interface ERP : aucun endpoint Gérant/Caissier, aucun bouton d’activation commerciale.

- Migration additive volontaire `020_platform_activation`, impliquant 019 uniquement (outre le socle 001–005). Aucun opt-in précédent ne sélectionne 020.
- Identité PostgreSQL dédiée : rôle de capacité NOLOGIN, sans attribution automatique à un compte. La fonction SECURITY DEFINER utilise `session_user`, jamais une identité fournie dans le JSON. Elle refuse les comptes propriétaires, superuser, BYPASSRLS, administrateurs et comptes disposant de droits directs sur les tables du schéma ou du rôle runtime.
- Reçu privé immuable, références de vérification non exposées au runtime/browser. Attribution, période 019, événement et reçu écrits dans une transaction unique.
- Aperçu sans écriture par défaut ; activation exige deux options CLI et une attestation JSON explicite. L’aperçu n’est pas une réservation : les contrôles sont rejoués à l’exécution.
- Même clé, commande et opérateur : retour idempotent ; modification de l’intention refusée. Référence externe unique globalement dans son espace de noms, même entre salons. Chevauchements de périodes refusés.
- Mois calendaire avec ancrage initial conservé, clamp de fin de mois, grâce 72 h ; bornes locales ambiguës ou inexistantes refusées. Le plan approuvé est installé seulement lors d’une activation explicite réussie, jamais lors de la migration ou d’un aperçu.
- Révocation d’un droit non annulée par rejeu de son activation. Un salon devenu inactif nécessite une revue opérateur, même pour un rejeu.

## Procédure opérateur — à réaliser sur environnement de recette d’abord

1. Vérifier sauvegarde **et restauration**, droits du compte de migration, version PostgreSQL et modèle de rôles Supabase. Appliquer uniquement après approbation l’opt-in `--include-platform-activation` avec `SALON_MARKETPLACE_BACKUP_VERIFIED=true`. Le flag atteste une opération humaine, il ne fait pas de sauvegarde.
2. Sous contrôle administrateur, provisionner un LOGIN nominatif restreint (NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOINHERIT), distinct du runtime et du propriétaire. Lui accorder la connexion et la seule appartenance au rôle `salon_pro_platform_` suivi des 12 premiers caractères du MD5 du schéma. Aucune appartenance n’est créée par la migration. Examiner les privilèges hérités/PUBLIC et refuser tout droit direct sur les tables. Tester aussi un login interdit et la révocation. Ne pas employer le compte propriétaire/pooler qui efface l’identité nominative.
3. Garder `SALON_PLATFORM_DATABASE_URL` dans l’environnement privé de la machine opérateur, connexion TLS vérifiée ; définir `SALON_PLATFORM_ACTIVATION_ENABLED=true`. Aucune reprise automatique de l’URL ERP. Ne jamais placer le secret dans les arguments, tickets, captures, dépôt ou chat. Le flag est un garde-fou CLI, pas l’autorisation DB.
4. Vérifier réellement le paiement sur la source externe de confiance : bénéficiaire, montant 4 900 XOF, devise, finalité, unicité, salon et période. Le logiciel ne contacte ni banque ni Mobile Money : l’attestation humaine n’est pas une preuve automatisée.
5. Sur machine POSIX privée, créer `.platform-activation/` appartenant à l’utilisateur, mode 0700 ; intention JSON en fichier simple mode 0600, sans lien symbolique/physique, taille maximale 16 384 octets. Ce répertoire est ignoré par Git. Fixer une clé d’activation UUID stable et conserver cette même intention pour les reprises. Choisir un espace de noms externe canonique partagé : changer de namespace/référence contournerait la détection sémantique d’un doublon de paiement.
6. Le JSON contient exactement : `activationKey`, `tenantId` (UUID minuscules), `billingAnchorAt` (UTC ISO avec millisecondes), `periodIndex` (0–1199), `evidenceNamespace` (2–40 caractères minuscules/chiffres/tirets/underscore), `externalReference` (120 max), `evidenceReference` (référence opaque 500 max, pas URL), `verificationReason` (500 max), `verifiedAmountXof` (4900), `externalVerificationConfirmed` (booléen). Utiliser uniquement des informations réelles ; ne pas joindre de secret ou document bancaire brut.
7. Lancer l’aperçu : `npm run platform:activate -- --file intention.json`. Contrôler salon, début, fin et grâce, puis exécuter seulement après vérification : `npm run platform:activate -- --file intention.json --execute --confirm-external-verification`, avec attestation JSON à true. La sortie ne contient que résultat, identifiants et dates ; les erreurs restent génériques.
8. En cas d’issue incertaine après perte réseau/COMMIT, réutiliser le fichier, la clé et le LOGIN d’origine ; ne pas créer une autre intention. Faire contrôler le reçu privé par une personne autorisée si nécessaire. Archiver les justificatifs dans un espace privé avec politique de conservation, pas dans Git. Révoquer l’appartenance/connexion et traiter les sessions déjà actives selon le protocole incident : une révocation ne garantit pas l’arrêt d’une transaction en cours.

Le provisionnement, la garde des secrets, les preuves de restauration et la recette TLS/rôles hébergée restent à réaliser. Ne pas recopier aveuglément une procédure de superuser local dans Supabase.

## Isolation et limites

Aucune écriture de caisse, rendez-vous ou prix ERP. Aucun compte ou abonnement réel créé pendant le développement. Les tests utilisent uniquement une base éphémère et des identités de test. Pas de DDL distant, déploiement, commit ou push.

Ce contrôle n’est pas une console plateforme avec MFA/SSO ; la possession du LOGIN dédié constitue l’authentification technique. La vérification externe reste humaine. Les reçus ne dédupliquent pas automatiquement les anciennes écritures 019 faites par un propriétaire ni les références sémantiquement identiques sous des valeurs différentes.

**Non livrés ici :** branchement aux gates 009, publication, quotas atomiques médias/prestations/utilisateurs, fermeture effective à expiration, demandes publiques, paiement automatisé. La publication 03D reste bloquée. Le calcul d’un droit ne rend pas le salon public. L’ERP existant reste préservé.

## Validation exécutée

- `npm run db:schema:check` : réussi.
- `npm run lint` : 0 erreur, 0 avertissement, 275 fichiers.
- `npm test` : **687/687 tests, 75 fichiers**, 559,41 s.
- `npm run build` : réussi ; avertissement de bundle existant (618,04 kB, gzip 183,62 kB).
- Tests ajoutés : transaction/rejeu/identité/privilèges/révocation, déduplication inter-salons, rollback audit et DDL/rôle, DST, opt-in indépendant, parsing strict, fichier privé et confirmations CLI.

Ces preuves PGlite/locales ne remplacent pas une recette PostgreSQL/Supabase multi-connexion avec restauration et authentification réelle. Suite recommandée : enforcement serveur des droits et quotas, puis publication sous contrôles explicites.
