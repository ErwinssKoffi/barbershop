# 03I — Précontrôle des migrations distantes et verrou restauration

Date : 1er novembre 2026.

## Demande et résultat actuel

Demande explicite : appliquer à distance les migrations importantes du projet. Cible vérifiée via le connecteur Supabase : **BarberShop**, référence `pfiuujyybxtpoetdkmbc`, PostgreSQL 17.11, eu-west-1, ACTIVE_HEALTHY. Le projet distinct rent_voiture n’a pas été modifié.

Contrôle distant en lecture seule :

- Base `postgres`, rôle d’exécution `postgres`.
- Schéma privé `salon_pro` : 28 tables.
- Registre applicatif : 001_baseline, 002_auth_security, 003_tenancy, 004_sessions, 005_sync_revisions.
- 1 tenant, 0 compte ; aucune information d’identité ou donnée financière extraite.
- 006–021 non appliquées.

À la question sauvegarde **et restauration**, l’utilisateur a confirmé : **« Sauvegarde seulement »**. Le verrou de sécurité n’est donc pas levé. Aucun DDL/DML distant, migration Supabase, changement de rôle, abonnement ou publication n’a été exécuté. Ne pas définir un flag BACKUP_VERIFIED pour contourner cette absence de preuve.

## Étape nécessaire : prouver une restauration

1. Identifier la sauvegarde réelle : date/heure, identifiant non sensible, projet source, méthode, chiffrement, périmètre (schéma, données, rôles/ACL nécessaires). Vérifier sa fraîcheur et la possibilité effective de la télécharger/restaurer. L’existence d’une sauvegarde ne suffit pas.
2. Préparer une destination **isolée et jetable**, jamais la base BarberShop active et jamais un autre projet métier. Une restauration peut écraser sa destination : vérifier explicitement l’identifiant cible. La création éventuelle d’un projet/une branche Supabase et ses coûts doivent être approuvés séparément.
3. Restaurer cette sauvegarde dans la destination isolée selon son format et la procédure du fournisseur. Ne pas remplacer ce test par une simple base vide suivie des migrations, ni par la copie du schéma courant. Les rôles, extensions, propriétaires, fonctions SECURITY DEFINER et politiques RLS doivent être compatibles ; ne pas élargir les privilèges pour masquer une erreur de restauration.
4. Comparer source et restauration : registre 001–005, tables, volumes agrégés, contraintes/index, fonctions/triggers, RLS FORCE et grants. Vérifier l’accès tenant autorisé et les refus d’accès, sans exporter de données privées dans les journaux. Si le backup inclut des données, les totaux de contrôle doivent correspondre au point de sauvegarde.
5. Sur la copie restaurée, exécuter la série 006–021 sélectionnée en transaction/verrou de migration, puis vérifier les contraintes financières, rôles privés/publics, RLS et droits 021. Ne créer aucun abonnement ni paiement de démonstration dans la vraie base. Consigner toute erreur et corriger/tester avant production.
6. Conserver une preuve non sensible : identifiant de la sauvegarde, date, destination isolée, résultat des contrôles et personne ayant vérifié. Ne transmettre ni URL de connexion, mot de passe, clé API, dump ou document métier dans le chat.

## Application distante après validation — pas encore exécutée

- Revérifier le registre distant et la dérive de schéma au moment du basculement ; ne pas rejouer 001–005 ni appliquer le snapshot complet `db/schema.sql`.
- Planifier les verrous et une fenêtre sans écritures concurrentes pour les migrations qui modifient les tables financières/ERP ; garder les flags fonctionnels fermés tant que la recette est incomplète.
- La série manquante actuelle est 006–021 : caisse, remboursements, agenda ; fondations Marketplace/horaires/catalogue/médias/notifications ; captures de prestations/blocages ; éditeur et dépublication ; abonnements, capacité opérateur et enforcement public. Appliquer uniquement après examen sur la restauration. Aucune migration ne remplace l’autorisation d’activer une fonctionnalité.
- Utiliser une transaction et le verrou applicatif de migrations, avec mise à jour cohérente du registre `salon_pro.schema_migrations`. Si le mécanisme Supabase de migration est utilisé, sa trace et le registre applicatif doivent tous deux refléter la réussite. Une erreur doit entraîner rollback, pas un enregistrement manuel de réussite.
- Vérifier après application : liste exacte des migrations, compteurs métier inchangés hors structure, RLS FORCE, absence de grants navigateur sensibles, droits runtime restreints, absence de plan/abonnement créé automatiquement, fonctionnement en lecture de l’ERP.
- Ne pas attribuer automatiquement le rôle opérateur 020 ; les logins nominatifs nécessitent un provisionnement séparé. Les flags de visibilité/publication ne sont pas ouverts par une migration.

## Frontières

Le connecteur utilisé permet les requêtes et migrations SQL, mais aucun outil de sauvegarde/restauration de backup n’est exposé. Aucune restauration réelle n’a été entreprise ni prétendue dans cette tranche. La validation locale précédente (696 tests et concurrence PostgreSQL 17.11) ne prouve pas la restauration du backup de cette base distante.

La publication web nécessite toujours la commande complète auditée, le stockage/traitement sécurisé des médias et la recette HTTPS/cache. **Statut : application distante bloquée par restauration non vérifiée ; No-Go production.**

## Clarification après confirmation de la référence

L’utilisateur précise qu’il s’agit d’un nouveau projet et confirme `pfiuujyybxtpoetdkmbc`. Un nouveau contrôle distant en lecture seule établit que les deux structures coexistent **dans cette même base** : 19 tables dans `public` (capture utilisateur) et 28 dans `salon_pro` (socle du code actuel). Aucune clé étrangère ne relie ces deux schémas dans les deux sens ; cela ne constitue pas une preuve d’absence de dépendance par fonction, vue ou application externe.

Comptages exacts sélectionnés : `public.tenants`, `public.services`, `public.appointments` : 0 ; `salon_pro.salon_users`, `salon_pro.revenues`, `salon_pro.expenses`, `salon_pro.cash_sessions` : 0 ; `salon_pro.tenants` : 1. Ces contrôles ne permettent pas d’affirmer que toutes les tables du projet sont vides. Le registre applicatif reste 001–005.

Décision de périmètre : les migrations du dépôt ciblent `salon_pro`, pas les tables `public` présentées dans la capture. Aucun renommage, remplacement, fusion ou suppression de ces tables n’est autorisé implicitement. Si le nouveau produit doit employer exclusivement les tables `public`, il faudra concevoir une adaptation du code et du modèle plutôt qu’y copier les migrations privées.

La sauvegarde fournisseur est déclarée datée du 1er novembre 2026 ; aucune restauration vérifiée n’a été établie. Le caractère nouveau du projet et les comptages sélectionnés ne constituent pas une preuve de restauration. Aucune migration distante appliquée lors de cette clarification.
