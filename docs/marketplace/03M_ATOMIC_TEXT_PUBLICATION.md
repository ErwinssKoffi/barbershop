# 03M — Publication textuelle atomique depuis l’ERP

1er novembre 2026. Suite du PROMPT 03, après aperçu complet 03L. Implémentation locale validée ; **aucune publication réelle ni migration distante**.

## Fonctionnalité livrée

Panneau Gérant « Publication textuelle sans photos » dans `/visibility` : contrôle serveur explicite, choix d’un identifiant public ASCII (3–100 caractères, minuscules/chiffres/tirets), confirmation de publication **sans aucune photo** puis commande serveur. Aucun slug de démonstration prérempli.

La transaction copie ensemble :

- profil public de base : nom, description, ville/commune et téléphone ;
- détails publics whitelisted : slogan, catégorie, adresse, WhatsApp, email et liens sociaux/site ;
- uniquement les prestations sélectionnées, avec nom/variante, description, prix et durée issus du catalogue ERP relu ;
- fuseau du salon, sept jours enregistrés (fermés compris), plages multiples et exceptions datées, **sans notes privées** ;
- nouvelle révision publique, incrément de version du profil, événement published et reçu de reprise immuable ;
- ouverture du gate seulement en fin de transaction, jusqu’à la grâce de la période active vérifiée.

Les prestations ont booking_requested=false et les anciennes règles publiques de réservation sont retirées lors de cette publication : ESSENTIEL n’autorise pas une réservation automatique. Aucun rendez-vous n’est créé/supprimé. Les demandes publiques à confirmer restent un autre parcours à implémenter.

## Pourquoi sans photos

Le stockage/traitement sécurisé n’est pas encore configuré. Les médias privés ne sont ni copiés, effacés, fetchés ni prétendument publiés. Si des photos publiques existent déjà, cette commande refuse l’opération au lieu de les retirer silencieusement ou d’en hériter sans revue. Le bouton photos reste désactivé et son libellé distingue désormais ce blocage de la publication textuelle.

C’est une première capacité de publication DB, **pas la totalité du PROMPT 03** : sa porte finale « publier une fiche et ses photos » reste non franchie. Le portail HTTP public n’est pas encore livré ; aucune URL de portail fictive n’est annoncée au succès.

## Autorité SQL et migration 022

Source `server/publishProfileSchema.ts`, export `supabase/optional/022_publish_profile_text.sql`, snapshot `db/schema.sql` régénéré. Deux tables additionnelles :

- `salon_public_details`, copie JSONB de dix champs sélectionnés explicitement, FORCE RLS, lecture publique seulement via la projection/gate ;
- `salon_publication_receipts`, privé, FORCE RLS, sans grant runtime/browser, immuable. La clé est tenant-scoped et lie acteur, version attendue, slug et résultat.

Fonction étroite `publish_salon_profile_text(TEXT,UUID,INTEGER,TEXT,BOOLEAN)`, SECURITY DEFINER, search_path pg_catalog et schéma fixé à l’installation. Elle ne reçoit ni prix, ni contenu public, ni période d’abonnement depuis le body. Grants PUBLIC/anon/authenticated/reader révoqués ; EXECUTE réservé au runtime serveur, sans grant d’INSERT/UPDATE direct sur les projections/gate. Les grants par défaut sur les nouvelles tables sont explicitement retirés pour runtime/reader avant sélection des droits.

La fonction vérifie le contexte tenant, Gérant/utilisateur actifs, tenant actif, confirmation non NULL, version et forme du slug. Elle acquiert le verrou Visibilité partagé par les éditeurs, verrouille tenant/profil/périodes et les sources sélectionnées. Droit actif obligatoire, sélection de 1 à 10 prestations pour ESSENTIEL, sept jours réellement enregistrés, aucune photo publique préexistante. Sources inactives, variante absente/dupliquée, prix non entier/hors borne et durée invalide sont refusés. Les compteurs atomiques 021 restent applicables aux projections insérées ; aucun contrôle UI ne remplace cette vérification SQL.

Un échec de source, unicité du slug, quota, audit, reçu ou contrôle final de gate annule toute la transaction, conservant l’ancienne copie. La dépublication 018 et l’expiration/révocation 021 ferment également la nouvelle table de détails à la lecture publique.

Le rôle runtime est une capacité serveur de confiance : l’acteur doit provenir de la session authentifiée, ce que fait l’API. Une fonction SQL recevant p_actor n’authentifie pas un navigateur à elle seule. Le flag HTTP est un garde-fou opérateur, pas une révocation de la capacité SQL d’un runtime compromis.

## API, flags et reprise

`POST /api/visibility/publication/publish`, corps exact : idempotencyKey UUID canonique, expectedVersion, slug, confirmedWithoutPhotos=true. Authentification, origine, tenant et rôle Gérant, rate limit et no-store réutilisés. Erreurs de version/clé, slug et validations métier explicites ; aucun justificatif ou détail de connexion retourné.

`SALON_TEXT_PUBLICATION_ENABLED=false` par défaut, documenté dans `.env.example`. Flag Visibilité existant également requis. Le statut préliminaire canPublish peut maintenant être true **uniquement** si la migration existe, le flag est actif et les contrôles préliminaires sont satisfaits. Le DTO exige cohérence entre canPublish et blockers ; ce booléen n’autorise pas SQL et ne dispense pas de la revue finale des sources dans la commande.

Même clé/acteur/version/slug : résultat `replayed`, sans nouvelle version ni audit de publication. Rejeu avec paramètres modifiés : conflit. Une copie dépubliée ou révoquée n’est pas réactivée par ce rejeu. Un acteur ou tenant désormais inactif reste refusé.

Le panneau conserve en mémoire l’intention originale après erreur et propose « Reprendre la même publication », sans changer clé/version/slug. Une erreur ne devient jamais un succès local. **Limite explicite :** l’intention n’est pas persistée au rechargement/changement d’espace. Ne pas fermer l’écran avec une issue incertaine ; un contrôle opérateur du reçu peut être nécessaire. Une intention définitivement périmée après modification concurrente exige revue de l’état, pas un changement silencieux de clé. Une solution durable de reprise multi-session reste une amélioration avant ouverture large.

Après succès, les éditeurs demandent relecture, l’aperçu complet est invalidé et le statut n’est pas supposé visible sans nouvelle vérification. Le reçu est une trace de la commande passée, pas une garantie que la fiche est encore visible maintenant.

## Application et recette

Opt-in **`--include-text-publication`** avec `SALON_MARKETPLACE_BACKUP_VERIFIED=true` après sauvegarde/restauration réellement vérifiées. Implique 009/010/011/012/016/017/018/019/021, outre le socle 001–005. N’implique ni finance/booking ni l’activation opérateur 020. Les anciens opt-ins ne sélectionnent pas 022. Migration sans plan/abonnement/compte/paiement créé automatiquement.

Ne pas activer le flag avant recette de la migration et d’un droit réellement vérifié sur environnement isolé. Aucune variable Vercel activée, migration Supabase, abonnement, publication réelle, déploiement, commit ou push dans cette tranche. Le dernier registre distant observé reste 001–005 ; absence de restauration hébergée prouvée inchangée.

## Validation réalisée

- **727/727 tests, 82 fichiers**, 694,26 s.
- Lint : 0 erreur/avertissement, 295 fichiers.
- Build et schema check réussis ; avertissement existant 618,04 kB (gzip 183,62 kB).
- 12 tests ajoutés (9 PG/API + 3 UI) : copie complète et visibilité publique RLS, reprise/conflit/non-résurrection, droit/source refusés, prix relu en republication, audit défaillant annulant les mutations, révocation fermant toutes les copies, grants/acteurs/API/flag, opt-in/export/pas de seed, quota de onze sélections conservant le brouillon, inter-tenant et confirmation NULL, UI/reprise et DTO.
- Régressions complètes exécutées. Tests PostgreSQL embarqué PGlite et transport UI simulé : **pas** une preuve de concurrence multi-connexion de cette nouvelle fonction ni une recette Supabase/HTTPS/cache. Les preuves PG17.11 de 03H portent sur les compteurs 021, pas sur toute la commande 022.

Restants : concurrence/réseau et restauration hébergés, médias sécurisés (provider, upload et décodage/variantes), portail public sous RLS et cache maîtrisé, demandes de contact/rendez-vous à confirmer. **No-Go production maintenu**, mais la commande de publication textuelle n’est plus un simple précontrôle.
