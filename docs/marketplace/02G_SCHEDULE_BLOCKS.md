# PROMPT 02G — Blocages privés de planning multijours

1er novembre 2026. Fondation locale, React/TypeScript/Vite conservé. **PROMPT 02 partiel ; production No-Go.**

## Livré

Migration additive optionnelle `015_schedule_blocks`, dépendant uniquement de 001–005, sans activer agenda, finance ou Marketplace :

- `schedule_blocks` : scope salon/employee explicite, instants timestamptz finis et ordonnés, note privée, état active/cancelled, créateur/annulateur, version et dates. Intervalles multijours sans limite métier inventée de huit heures. Index tenant-scoped des blocs actifs.
- `schedule_block_events` : événements created/cancelled/employee_detached append-only, version unique par bloc, acteur humain lorsque connu et rôle SQL. FK parent/acteur tenant-composites.
- FK `(tenant_id,employee_id)` vers employees ; FK composite vers memberships pour les acteurs. Création/annulation exige Gérant actif, compte et tenant actifs. Employé actif du même tenant requis à la création d’un bloc employé.
- Enveloppe immuable : une correction exige annulation puis nouvelle création. Version et dates dérivées en DB. Aucune résurrection ou suppression physique des blocs ; aucun UPDATE/DELETE du journal.
- ENABLE/FORCE RLS sur les deux tables, runtime lecture seule de son tenant. Aucune écriture runtime ni exposition PUBLIC/anon/authenticated, y compris après grants navigateur hérités des defaults. Fonctions trigger révoquées aux navigateurs ; recherche pg_catalog et tables qualifiées par schéma du trigger. Audit SECURITY DEFINER borné à l’insertion de l’événement.

Les événements référencent le bloc dont l’enveloppe reste immuable : ils ne dupliquent pas inutilement la note privée dans chaque événement. Le journal et le changement du bloc sont atomiques.

## Purge des employés et conservation

La FK utilise `ON DELETE SET NULL(employee_id)` : seule la référence vivante est détachée, jamais tenant_id. `employee_ref` conserve l’identifiant historique et scope reste employee, même après suppression. Le trigger n’autorise ce détachement que lorsque la source n’existe plus ; une tentative directe tant que l’employé existe est rejetée. Un événement employee_detached avec acteur humain NULL est enregistré, sans utilisateur système fictif. Le rôle SQL reste tracé ; ce n’est pas une preuve d’identité du responsable humain de la purge.

Un bloc détaché est conservé comme historique, **pas comme une fermeture du salon**. Un futur calcul de disponibilité doit utiliser la référence vivante pour les blocs employé, pas seulement employee_ref, afin de ne pas appliquer un ancien bloc à un nouvel enregistrement réutilisant le même identifiant. L’annulation d’un bloc historique reste possible via une future commande autorisée. Aucune donnée de paie/contact copiée ici.

## Types et validations

`src/domain/scheduleBlocks.ts` : contrat privé de création, validation stricte et primitive interne de chevauchement. Entrées UTC `Z` explicites, dates calendaires valides, intervalle non vide, scope cohérent, note bornée et champs inconnus refusés. La conversion depuis un horaire local/fuseau/DST reste à implémenter côté serveur, sans supposer le fuseau du navigateur.

Chevauchement demi-ouvert `[start,end)` : deux bornes adjacentes ne se chevauchent pas. Un bloc salon s’applique à chaque employé ; un bloc employé uniquement à sa référence vivante ; cancelled et détaché ne bloquent pas. Les chevauchements entre blocs sont autorisés : ce sont des obstacles à unir, pas des réservations mutuellement exclusives.

La primitive ne produit pas une liste publique d’absences, ne lit pas la DB et ne vérifie pas à elle seule le tenant. Le futur appelant doit lire les blocs sous le contexte tenant vérifié. Aucun endpoint public ne doit exposer note, acteur ou planning privé. Les modèles privés et la primitive booléenne ne sont pas un calcul complet de disponibilité.

## Activation et compatibilité

`--include-schedule-blocks` est un opt-in indépendant, exigeant `SALON_MARKETPLACE_BACKUP_VERIFIED=true` au CLI. La variable exprime une approbation opérateur après sauvegarde/restauration effectives ; elle n’exécute pas ces opérations et n’en constitue pas une preuve. Aucun opt-in existant n’active 015. Registre, SQL optionnel et snapshot généré alignés.

Aucun seed métier. Migrations sources/exports 008–014 inchangés par SHA256. Agenda 008, pauses internes, commandes booking, API et packages inchangés dans ce lot. Les tables existent sans rendez-vous, puisque 008 n’est pas une dépendance. Aucun effet sur caisse, stock ou revenus.

**Pas de raccordement à createBooking ni de nouvel écran/endpoint.** L’insertion/annulation reste réservée aux tests et à un futur chemin serveur de confiance ; aucun droit SQL global de migration ne doit être transmis au navigateur. La future commande devra utiliser l’acteur de session authentifié, version attendue, verrouillage partagé avec les réservations, idempotence et traitement des rendez-vous déjà pris.

## Validation obtenue

- `npm run lint && npm test && npm run build` réussi.
- **581/581 tests, 62 fichiers**, 471,68 s ; début 09:28:46 UTC le 1er novembre 2026.
- 9 tests SQL + 22 domaine/CLI + 1 registre ajoutés. Isolation, acteur, source inter-tenant, grants, immutabilité, annulation, purge réelle sous rôle runtime, rollback métier/DDL et indépendance de migration vérifiés.
- Lint 240 fichiers, zéro avertissement/erreur.
- `db:schema:check`, `git diff --check`, hashes 008–014 réussis ; contrôle supplémentaire des fichiers non suivis et liens documentaires.
- Build : avertissement de chunk préexistant non bloquant, 613,89 kB (182,40 kB gzip).
- `db:check` : code 1, missing_configuration, checkoutReady/refundsReady false. Aucune recette hébergée acquise.
- Aperçu Vite 4173 HTTP 200, sans nouvelle interface de planning à recetter visuellement.

PGlite vérifie les contraintes/RLS et les transactions séquentielles, pas la concurrence réelle multi-connexion PostgreSQL. Il n’existe pas encore de verrou commun entre ces blocs et l’agenda : aucune garantie d’absence de réservation concurrente avec une fermeture ne peut être annoncée.

Aucun DDL distant, déploiement, provider, secret, commit ou push effectué.

## Repli et blocages

Un échec d’application annule transactionnellement toute la DDL et l’enregistrement 015 ; testé. Après application réussie : ne pas connecter les futurs producteurs/consommateurs, préserver blocs et journal privés. Pas de script destructif ou de purge automatique comme rollback. Sauvegarde/restauration hébergées non prouvées : activation distante bloquée et production No-Go.

PROMPT 02 reste partiel : plans/droits/souscriptions/événements commerciaux non implémentés (transitions et effets à approuver dans [ADR-005](adr/ADR-005_ENTITLEMENTS.md)), acteur public et contraintes de concurrence de réservation à définir, puis recette PostgreSQL hébergé. La ligne « blocs multijours dédiés » de la matrice historique [02F](02F_APPOINTMENT_SERVICE_SNAPSHOTS.md) dispose maintenant de son socle local ; le branchement fonctionnel reste futur. Les interfaces/publication, stockage sécurisé et réservation publique relèvent des tranches suivantes, pas de cette livraison.
