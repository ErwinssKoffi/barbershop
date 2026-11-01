# PROMPT 03A — Fonctionnalité Gérant « Visibilité en ligne » : brouillon

1er novembre 2026. Première tranche fonctionnelle de PROMPT 03 ; **pas la livraison complète du profil public/galerie**. React/TypeScript/Vite conservé. L’autorisation utilisateur de passer aux fonctionnalités ne lève pas les blocages d’activation distante.

## Parcours livré

Menu Gérant et route `/visibility`, protégée par le contrôle de rôle existant. Un Gérant connecté à un tenant Cloud peut charger son profil, créer/modifier nom public, description, ville, commune/quartier et téléphone public facultatif, voir l’aperçu non publié, puis enregistrer le brouillon sur le serveur. Champs initialement vierges ; aucune copie automatique de données privées ou fictives. Pas de stockage Dexie/localStorage/sync du brouillon.

Chargement explicite avant édition. Sauvegarde avec version attendue (0 à la création), état occupé empêchant les doubles soumissions. Après erreur/conflit/résultat incertain, sauvegarde interdite jusqu’à relecture. Un rechargement remplace volontairement les modifications locales non enregistrées ; il est identifié comme tel par son libellé. Les réponses après changement de compte/espace sont ignorées ; composant recréé par workspaceKey. L’aperçu affiche le texte via React, pas du HTML brut.

## API et persistance réelles

- `POST /api/visibility/read` avec objet vide.
- `POST /api/visibility/save` avec champs autorisés et expectedVersion ; tenant et acteur proviennent exclusivement de la session serveur vérifiée.
- Authentification/session vivante et tenant actif via le handler existant ; Gérant exigé dans la route et appartenance active relue dans la transaction.
- Contrôle d’origine existant, rate limit 60 appels/minute par acteur/tenant, corps JSON borné par le handler partagé. Le contrôle existant refuse cross-site/origine étrangère mais accepte une absence d’Origin : ne pas le présenter comme une preuve générale de CSRF durci. Authentification Bearer nécessaire pour ces routes.
- Contexte runtime soumis à RLS, verrou advisory tenant-scoped puis FOR UPDATE du brouillon existant, version vérifiée avant mutation. Délais de verrou/requête bornés sur sauvegarde.
- Profil et événement draft_saved atomiques ; échec de l’audit annule l’écriture. Aucune élévation au rôle de migration pour sauvegarder.
- Réponse en allowlist de champs privés de brouillon, tenant explicitement vérifié par le client. `Cache-Control: no-store` du handler existant ; pas d’endpoint de publication ni lecture anonyme ajouté.

Implémentation : `server/visibility.ts`, `src/domain/visibility.ts`, `src/lib/visibilityClient.ts`, `src/features/visibility/VisibilityPage.tsx` et raccordement au handler/router/navigation existants.

## Activation et limites

`SALON_VISIBILITY_ENABLED=false` par défaut dans `.env.example`. Pour un environnement de recette préparé, appliquer préalablement 009 après backup/restore vérifiés et activer ce flag serveur privé. Aucun flag ne déclenche une migration automatique. Flag absent/faux → erreur VISIBILITY_DISABLED ; migration absente → VISIBILITY_MIGRATION_REQUIRED. L’écran présente l’erreur, sans succès fictif ni sauvegarde locale de remplacement.

La configuration Cloud locale reste absente ; **la fonctionnalité n’est donc pas opérationnelle contre une base hébergée dans ce sandbox**. Elle est exercée via les tests API/PostgreSQL embarqués et UI, pas une recette utilisateur HTTPS complète. Aucun flag distant, secret, migration distante, provider ou déploiement modifié.

Cette tranche ne modifie jamais la projection publiée. Elle permet d’enregistrer un brouillon incomplet ; une future commande de publication exigera les champs publics requis et droits appropriés. Slogan, catégorie, adresse détaillée, autres contacts/réseaux, médias/upload, tri de galerie, sélection des prestations, horaires, publication/dépublication et invalidation de caches publics restent à implémenter. Pas de faux provider, quota commercial ou entitlement inventé. Publication maintenue fermée en attendant l’autorité serveur des droits et le raccordement sûr.

Les fondations de PROMPT 02 restent partielles : voir [02G](02G_SCHEDULE_BLOCKS.md) et [ADR-005](adr/ADR-005_ENTITLEMENTS.md). Ce parcours n’active pas la réservation publique, les souscriptions ou le stockage média et ne modifie ni la caisse ni l’agenda.

## Validation

- **591/591 tests, 64 fichiers**, 480,09 s ; début 09:46:54 UTC le 1er novembre 2026.
- 6 tests API/PostgreSQL : création/modification, versions, audit, rollback, origine/session/rôle, tenant externe, désactivation/migration absente, absence d’effet financier/public et validation des champs.
- 4 tests UI : parcours charger/éditer/enregistrer, texte échappé, relecture après échec, refus Caissier, changement d’espace et réponse tardive. Les appels du client sont simulés dans les tests UI ; la vérification transport complète navigateur/HTTPS reste à faire.
- `npm run lint && npm test && npm run build` réussi. Lint 246 fichiers, zéro avertissement/erreur.
- `db:schema:check` et `git diff --check` réussis ; aucune nouvelle migration ni modification des sources/exports SQL dans ce lot.
- Avertissement de chunk principal >500 kB persistant : 618,04 kB, gzip 183,62 kB.
- `db:check` : code 1, missing_configuration, checkoutReady/refundsReady false.
- Aperçu Vite `/visibility` HTTP 200 ; pas de preuve de navigation authentifiée ou de capture visuelle automatisée.

PGlite ne prouve pas la concurrence réelle multi-connexion PostgreSQL. Réception d’une réponse perdue après commit : recharger le brouillon, ne pas supposer l’échec et relancer aveuglément une création.

## Avancement et repli

Avancement consigné dans `IMPLEMENTATION_PROGRESS.md`. Prochaines tranches : compléter les champs du profil, raccorder sélection catalogue/horaires, puis publication sous droits explicites et chaîne média sécurisée. Aucune date ou complétude de ces éléments n’est annoncée ici.

Repli : remettre SALON_VISIBILITY_ENABLED=false et masquer la navigation si nécessaire ; conserver profils et événements. Aucun DROP/backfill/purge destructif. Pas de suppression d’écritures financières, d’utilisateurs ou d’anciens profils. Production No-Go sans recette Cloud, backup/restore hébergé et validation des conditions de publication.
