# Rendez-vous — lot 1 : agenda interne multi-tenant

## Portée livrée

L’agenda authentifié `/booking` est optionnel et désactivé par défaut. Ce lot n’est pas
une page de réservation publique. Il ne modifie ni la caisse, ni les files de vente,
ni les modules existants et ne devient jamais une condition pour encaisser.

- Agenda journalier, filtre employé et consultation de tous les postes du salon.
- Rendez-vous avec employé/prestation actifs, nom client saisi, contact facultatif, note,
  date/heure et durée manuelle (5 minutes à 8 heures).
- Indisponibilité (pause/absence) pour un employé, par bloc de 8 heures maximum.
- Déplacement dans le temps sur le même employé, avec détection de conflit.
- Statuts Prévu, Confirmé, Arrivé, Terminé, Annulé, Absent ; transitions contrôlées.
  Terminer un rendez-vous ne crée et ne confirme aucun encaissement.
- Gérant actif : création et modifications. Caissier actif : consultation uniquement.
- Noms de prestation/employé conservés en snapshots ; aucun catalogue d’exemple injecté.

## Sécurité et concurrence

Toutes les routes sont POST, sous session authentifiée, rôle/appartenance relus côté serveur :
`/api/booking/list`, `/api/booking/create`, `/api/booking/update`.
Le tenant est issu du jeton résolu, pas du corps. Les tables `bookings` et `booking_events`
ont RLS forcée. Aucun droit navigateur anon/authenticated/PUBLIC. Le rôle runtime ne peut
ni supprimer les rendez-vous, ni modifier/supprimer les événements.

Une mutation prend un verrou transactionnel de planification par schéma/salon **avant**
la consultation des disponibilités. Les mutations API de ce salon sont ainsi sérialisées ;
les conflits sont relus après acquisition du verrou. Un créneau est semi-ouvert [début,fin[ :
les créneaux adjacents sont admis. Annulé/Absent libèrent le créneau ; Terminé conserve son
occupation historique. Les indisponibilités participent aux mêmes contrôles.
Ce contrôle est applicatif sous verrou PostgreSQL : une écriture SQL privilégiée qui
contourne l’API n’est pas couverte par une contrainte SQL d’exclusion.

Création : clé stable et hash du contenu normalisé, uniques par salon. Rejouer la même clé
et le même contenu avec le même acteur renvoie le rendez-vous actuel, sans nouvel événement.
Un changement de contenu ou d’acteur avec cette clé est refusé. Après un échec réseau le
formulaire conserve sa clé ; après un rechargement de page, consulter l’agenda avant une
nouvelle saisie (pas de file hors-ligne ni de conservation de la clé après fermeture).

Modification : version attendue obligatoire, conflit 409 si un autre poste a modifié le
rendez-vous. Recharger après un résultat incertain ; pas de rejeu automatique de mutation.
Les changements et leur événement avant/après sont atomiques, avec acteur et horodatage.
Une erreur d’audit annule aussi la mutation. Les statuts terminaux ne sont pas réouverts.

Le transport est de même origine, sous jeton capturé, sans remplacement de compte lors
d’une reprise. Une réponse d’un autre salon ou d’une ancienne session est refusée.
Les résultats sont volatils et retirés lors d’un changement de jour/filtre/compte.

## Activation contrôlée — aucune migration hébergée appliquée dans ce lot

1. Sauvegarder la base et vérifier une restauration dans un environnement isolé.
   Les autorisations suivantes ne constituent pas une preuve automatique de restauration.
2. En recette, configurer la connexion privée puis, seulement après ces vérifications :

   ```sh
   SALON_BOOKING_BACKUP_VERIFIED=true npm run db:migrate -- --include-booking
   ```

   L’option applique la baseline et **008** ; elle n’active pas 006/007. Ne pas appliquer
   `db/schema.sql` en bloc : il inclut aussi les migrations financières optionnelles.
3. Activer `SALON_BOOKING_ENABLED=true` sur le serveur et `VITE_BOOKING_ENABLED=true` pour
   le build de recette. Reconstruire/redéployer après modification de la variable VITE.
   L’absence de ces variables vaut désactivation. Ne pas copier des secrets de production
   vers un environnement de démonstration.
4. Enregistrer de vrais employés et prestations autorisés ; le formulaire n’est pas
   prérempli et la création est bloquée si le catalogue local est vide. Le serveur revalide
   le catalogue même si la copie locale est ancienne.
5. Recetter sur deux sessions/appareils : même créneau concurrent, pauses, bornes adjacentes,
   déplacement concurrent, version périmée, réponse perdue/rejeu, annulation et isolation.
   Vérifier aussi que la caisse fonctionne lorsque l’agenda est désactivé.

La route refuse sans flag serveur ou sans tables 008 ; aucune migration automatique depuis
une requête. Désactiver les flags ne supprime pas les rendez-vous ni leurs événements.
Le quota API est de 120 requêtes/minute par compte/salon. Les recherches sont bornées à
31 jours et 200 résultats, avec indicateur explicite de troncature. Les verrous ont une
attente maximale de cinq secondes ; aucune écriture partielle en cas d’échec.

## Limites explicites / étapes suivantes

- Pas encore de réservation publique, lien propre au salon, authentification du client,
  confirmations ou rappels SMS/email/WhatsApp, acomptes ou paiements d’abonnement.
- Pas encore d’horaires hebdomadaires automatiques, congés multi-jours, gestion de cabines,
  récurrences, durée issue du catalogue/variantes ou drag-and-drop calendrier.
- Horaires affichés/saisis dans le fuseau du navigateur, annoncé à l’écran ; stockage UTC.
  Un fuseau IANA paramétré par salon et les règles de changement d’heure restent à intégrer.
- Pas de dossier CRM, d’import automatique vers la caisse ou de vente anticipée. L’employé
  d’un rendez-vous ne peut pas encore être remplacé : annuler et créer un nouveau rendez-vous.
- Liste journalière, pas encore une grille visuelle hebdomadaire.
- Le JSON de sauvegarde métier local ne contient pas l’agenda serveur. Prévoir une sauvegarde
  PostgreSQL incluant les deux tables et une politique de rétention des coordonnées/audits.
- Les tests PGlite contrôlent les conflits, l’ordre du verrou, le rollback et les permissions,
  mais ne remplacent pas une recette simultanée sur plusieurs connexions PostgreSQL réelles.
- `cloud:check` conserve son périmètre baseline/financier : il n’atteste pas la recette 008.

La validation locale et la préparation des fichiers ne constituent ni un déploiement,
ni une activation du booking hébergé, ni une autorisation de production.

## Validation locale

Suite complète : **402/402 tests dans 50 fichiers**, 379,65 s. Lint sans avertissement,
build, contrôle du snapshot SQL et diff check réussis. Le build émet uniquement
l’avertissement existant de taille des chunks. Les tests couvrent les bornes adjacentes,
les indisponibilités, le rejeu de création, les conflits/version, les statuts, les accès
et l’isolation, les erreurs d’audit avec rollback, ainsi que les réponses tardives et
la conservation de clé après erreur réseau. Aucun test ne peuple la base hébergée.
