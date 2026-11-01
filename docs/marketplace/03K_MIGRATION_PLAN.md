# 03K — Diagnostic de préparation des migrations

1er novembre 2026 — reprise après configuration de la cible officielle.

## Livré

Commande `npm run db:migrations:plan`, sans argument et sans écriture. Elle charge uniquement la configuration serveur privée et utilise une transaction REPEATABLE READ READ ONLY avec timeout 5 s pour lire le registre explicitement qualifié `salon_pro.schema_migrations`. Aucun repli sur public, aucune migration, seed, activation, modification de rôle ou récupération de secret.

Le CLI exige le verrou de cible officielle 03J lorsqu’une connexion est renseignée. Il compare les identifiants aux migrations connues du dépôt et retourne : statut, référence attendue, schéma, migrations connues présentes/manquantes, nombre d’identifiants inconnus. Les valeurs inconnues du registre et les erreurs du driver ne sont jamais affichées. Un registre incohérent, étranger, surdimensionné ou incomplet n’est pas un succès.

`executionAuthorized` reste toujours false et `restoreVerification` reste `not_established_by_this_check`, y compris si toutes les migrations figurent au registre. Un inventaire n’est ni un contrôle de checksum SQL/DDL, ni une preuve de restauration des données, ni une autorisation d’exécution. Les dépendances détaillées/grants et les migrations optionnelles à sélectionner doivent toujours être revus avant application. Le code de sortie 0 signifie uniquement « inventaire lu avec socle connu et sans conflit d’identifiants ».

## État réel vérifié

Nouveau contrôle distant en lecture seule via Supabase : même cible `pfiuujyybxtpoetdkmbc`, registre **001–005**, **28 tables salon_pro**, **19 tables public**. Aucun changement distant observé dans ce contrôle, aucune écriture effectuée. Les migrations 006–021 restent à appliquer après recette/restauration validée.

Exécution locale de la nouvelle commande : `missing_configuration`, sortie 1. Sans connexion, la liste pending est le catalogue candidat complet, **pas une observation de la base distante** ; aucune conclusion d’absence de 001–005 n’en découle. La référence du résultat est la cible attendue, pas un identifiant lu dans le serveur. La configuration privée locale reste à fournir dans l’environnement serveur, jamais en chat. Aucune copie des secrets Vercel n’est tentée.

## Validation

- Lint : 0 erreur/avertissement, 284 fichiers.
- Tests complets : **706/706, 78 fichiers**, 623,92 s.
- Build/schema/diff : réussis ; avertissement bundle existant 618,04 kB (gzip 183,62 kB).
- Six tests du diagnostic : lecture seule, socle/complet, aucun fallback public, conflits redigés, rollback/libération et absence de configuration. Les tests utilisent des doubles SQL, pas une preuve de restauration ni de connexion locale.

Aucun déploiement, migration distante, abonnement ou rôle opérateur activé. La sauvegarde fournisseur déclarée du 1er novembre n’a toujours pas de restauration prouvée. La publication web reste fermée ; No-Go production maintenu.
