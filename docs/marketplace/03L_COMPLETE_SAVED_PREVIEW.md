# 03L — Aperçu complet des données enregistrées

1er novembre 2026. Suite fonctionnelle du PROMPT 03 : aperçu avant publication. React/TypeScript/Vite conservés.

## Fonctionnalité livrée

Dans `/visibility`, panneau « Aperçu complet enregistré », chargé explicitement depuis le serveur :

- identité publique, description, slogan, catégorie, localisation/adresse et contacts publics ;
- seules les prestations sélectionnées, avec libellé de variante, description, prix XOF et durée relus du catalogue ERP ;
- semaine complète avec plages multiples, jours fermés, exceptions datées et fuseau réel du tenant ;
- version du profil et instant du snapshot ; distinction explicite entre données enregistrées et modifications locales non sauvegardées ;
- signalement des prestations sélectionnées devenues indisponibles, sans prix/durée de remplacement et sans omission silencieuse ;
- photos non raccordées explicitement indiquées, aucune image ou horaire commercial de démonstration, aucun lien public généré.

Cet aperçu reste consultable sans abonnement, pour préserver la préparation du brouillon. Il ne calcule pas les créneaux disponibles et n’effectue aucune réservation. La confirmation d’une demande de rendez-vous et les droits de publication restent distincts.

## API et cohérence

`POST /api/visibility/preview/read`, corps strictement vide. Session vivante, origine, rate limit existant, tenant actif et Gérant vérifiés. Aucune identité/prix/date arbitraire acceptée du navigateur. Réponses privées via le handler existant no-store ; aucun endpoint public ajouté.

La lecture métier utilise une transaction **REPEATABLE READ READ ONLY**, sous le rôle runtime tenant-scoped. Les champs profil, sélection, détails, sources ERP, horaires et fuseau appartiennent au même snapshot. Le garde Visibilité reçoit une option interne de lecture snapshot sans FOR SHARE (interdit en READ ONLY) ; les commandes existantes conservent leur garde verrouillant par défaut. L’option ne provient jamais du body HTTP. Le rate limit du handler conserve ses propres écritures techniques préexistantes hors snapshot ; aucune écriture de profil, projection ou audit métier n’est produite par l’aperçu.

Le snapshot est une photographie de lecture, pas une réservation de version ou de prix. L’instant capturé et la version affichés ne dispensent pas la future commande publish de relire les sources, verrouiller et contrôler droits/quotas atomiquement. Une révocation concurrente d’accès après le début d’une requête ne transforme pas ce snapshot en droit d’écriture.

## Isolation et client

DTO explicitement sélectionné et validé serveur/client. Les payloads ERP complets, commissions, consommables, notes privées d’exceptions, références de paiement et clés de stockage ne sont pas sérialisés. Description et liens sont rendus comme texte React : aucun HTML injecté ni téléchargement externe. Une source inactive ou des variantes invalides n’est pas remplacée par une fausse offre.

Le client réutilise la capture de session et le contrôle d’espace existants. Aucune sauvegarde locale de remplacement. Une relecture retire d’abord l’ancienne copie ; un refus laisse l’aperçu vide avec message. Les sauvegardes profil/configuration et la dépublication réalisées dans cet éditeur invalident l’aperçu affiché ; les changements effectués ailleurs requièrent une relecture explicite. Les réponses tardives d’un composant démonté ne sont pas affichées.

Le libellé du bouton Publier désactivé a été corrigé en « parcours de mise en ligne incomplet » : les droits serveur existent depuis 03H, ce n’est plus leur absence qui justifie ce blocage.

## Prérequis et limites

Aucune nouvelle migration. Parcours exige 009/010/011/016/017 et `SALON_VISIBILITY_ENABLED=true`. Les opt-ins distants restent fermés ; aucune migration automatique. Pas de déploiement ou test Cloud authentifié prétendu. La base officielle distante reste non migrée au-delà du dernier inventaire 001–005 ; restauration hébergée non prouvée.

Non livrés ici : commande de publication atomique, copie publique complète des détails, upload/traitement/stockage sécurisé, portail public, mode de prévisualisation mobile/desktop dédié et recette hébergée HTTPS/cache. Cet aperçu privé prépare ces étapes sans prétendre les remplacer. Publication web fermée et **No-Go production maintenu**.

## Validation

- **715/715 tests, 80 fichiers**, 664,23 s.
- Lint : 0 erreur et 0 avertissement sur 289 fichiers.
- Build : réussi ; avertissement existant du bundle principal 618,04 kB (gzip 183,62 kB).
- Schema check et diff check : réussis.
- Neuf tests ajoutés (6 API/PostgreSQL/DTO + 3 UI) : données enregistrées, prix de variante relu, source indisponible, exclusions privées, absence d’effets financiers/projection/audit métier, auth/origine/tenant, migration manquante, READ ONLY réellement imposé, DTO incohérent, échappement UI, retrait de copie périmée et invalidation de version.
- Régressions complètes exécutées. Le premier test ciblé a détecté le FOR SHARE du garde incompatible READ ONLY, corrigé par option interne dédiée ; aucun timeout augmenté ni assertion supprimée.

Ces tests PGlite/UI ne sont pas une recette navigateur réelle ou multi-connexion hébergée. Aucun DDL distant, souscription réelle, provider média, commit ou push dans cette tranche.
