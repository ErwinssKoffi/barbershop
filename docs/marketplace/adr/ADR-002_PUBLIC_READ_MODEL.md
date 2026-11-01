# ADR-002 — Projection publique et résolution sécurisée des slugs

- Date : 2026-11-01.
- Statut : **PROPOSÉ — validation requise avant code/DDL**.
- Liens : [architecture](../01_TARGET_ARCHITECTURE.md), [droits](ADR-005_ENTITLEMENTS.md).

## Contexte et alternatives

Les transactions privées exigent un tenant ; un annuaire doit chercher des slugs entre tenants. `salon_users`/tables globales ne sont pas toutes protégées comme les tables métier. Réutiliser la sync, `SalonInfo`, un rôle propriétaire ou une politique `anon SELECT` est exclu.

Options : lecture directe des tables privées avec filtre applicatif (rejetée, surface de fuite) ; vue/fonction joignant de nombreux payloads privés (complexe à auditer et à publier) ; **projection dédiée limitée à une révision explicitement publiée**, retenue.

## Décision recommandée

Dans le schéma privé, concevoir des données distinctes : brouillon tenant-scoped, révision publiée allowlist, index de slug unique global, services/médias publics et **gate de visibilité**. Noms indicatifs, schéma exact en phase 02. L’index ne rend pas un slug brouillon découvrable par API. Slugs normalisés/validés, unicité vérifiée transactionnellement ; collision renvoyée sans nommer l’autre tenant.

Le gate porte l’autorisation publique : publication/modération, activité sécurité du tenant et borne temporelle des droits. Toute mutation source fermant l’accès doit fermer le gate **dans la même transaction**, via mécanisme DB testé pour les chemins privilégiés prévus ; ne pas compter uniquement sur un événement asynchrone. Une échéance est vérifiée au temps PostgreSQL à chaque lecture, même si le worker/cron est arrêté. Le changement de plan ne peut pas laisser une ancienne autorisation plus large active.

### Rôles SQL et RLS

- Édition : contexte tenant existant, RLS ENABLE + FORCE sur données tenant-scoped, version et permission Gérant/entitlement.
- Lecture publique : rôle serveur dédié NOLOGIN, NOSUPERUSER, NOBYPASSRLS, sans CREATE ni écriture, sans privilèges sur tables métier/globales. Uniquement SELECT sur projections/gates nécessaires.
- Projections et gates restent sous FORCE RLS. Politique lecteur cross-tenant **explicite et limitée** aux gates effectivement publiables ; politique d’écriture tenant distincte. Aucun `USING(true)` sur tables privées existantes.
- Les jointures de policy ne doivent pas introduire de récursion RLS. Définir en phase 02 un gate lisible uniquement dans son état autorisé par le lecteur et une policy de projection référençant ce gate ; tester rôles sans contexte et refus par défaut. Pas de dépendance SELECT à `salon_users`, `employees` ou revenus pour le lecteur.
- Les migrations restent sous un compte distinct ; retirer les privilèges SQL par défaut de PUBLIC/anon/authenticated. La connexion applicative ne doit pas obtenir des droits globaux supplémentaires sous prétexte d’annuaire.

Un module serveur de lecture active ce rôle uniquement dans sa transaction de lecture ; aucune requête arbitraire fournie par le navigateur. Préférer ce mécanisme à une fonction SECURITY DEFINER privilégiée pour le MVP. Si une fonction est finalement nécessaire, elle exigera un propriétaire restreint sans BYPASSRLS, `search_path` fixe, noms qualifiés, arguments bornés, EXECUTE révoqué de PUBLIC et tests dédiés avant changement de cette décision.

### Résolution du tenant

`slug → projection visible → identifiant tenant interne` se fait uniquement côté API. L’API sérialise une allowlist sans tenant/org/user IDs. Pour booking, l’identifiant résolu permet de démarrer une **nouvelle transaction tenant** ; le gate/entitlement est relu sous verrou dans cette transaction. La lecture préalable n’autorise pas une réservation si le salon a été dépublié entre-temps. Ne jamais accepter un `tenantId` client en remplacement.

### Publication et cache

Validation, révision publiée, projection, gate et audit dans un commit unique. L’édition du brouillon ne modifie pas la version publique. Au MVP, HTML/API/fetch `no-store`, pas d’ISR/CDN de fiche ; aucune invalidation différée comme seul garde-fou. Dépublication/suspension/expiration : prochaine lecture ne retourne plus de DTO. Retirer aussi la diffusion média contrôlée ; les copies déjà téléchargées hors plateforme ne peuvent pas être rappelées.

## Tests et porte

- Exécuter avec le rôle lecteur réel : pas de SELECT privé/global ni écriture ; pas d’EXECUTE/public grants non prévus.
- Deux tenants, slugs uniques/collisions, brouillon, révision publiée et édition ultérieure ; aucune fuite de contact privé ou champ JSON nouvellement ajouté.
- Suspension, dépublication, expiration à horloge DB sans worker, baisse de droits ; absence/privé retournent 404 identique.
- Course résolution→dépublication→création, policy RLS sans contexte et transactions réutilisant un pool ; rôle/contexte nettoyés au commit/rollback.
- Vérifier DTO, HTML, OG, sitemap, erreurs et caches, pas seulement JSON de fiche.

Aucune policy ni table créée dans ce lot. Cette conception ajoute une capacité cross-tenant strictement bornée, pas un contournement de l’isolation métier.
