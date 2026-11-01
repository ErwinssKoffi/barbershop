# ADR-006 — Origines séparées, proxy public borné et sessions ERP isolées

- Date : 2026-11-01.
- Statut : **PROPOSÉ — noms DNS et déploiement à valider**.
- Liens : [architecture](../01_TARGET_ARCHITECTURE.md), [portail](ADR-001_PUBLIC_PORTAL.md), [médias](ADR-003_MEDIA_STORAGE.md).

## Contexte / options

API relative `/api`, refresh cookie actuel `salon_pro_refresh`, HttpOnly, SameSite=Strict, Path=/api/auth, Secure en production, sans Domain. `assertSameOrigin` compare actuellement Origin au Host ; il ne peut pas être réutilisé aveuglément derrière un proxy changeant l’hôte. CSP root autorise images self/data/blob, pas un CDN distant ; SW et rewrites sont ERP.

Options : origine unique et préfixes publics/ERP (cookies faciles mais SW/routage couplés) ; appels navigateur directs cross-origin (CORS credentials/CSRF et sessions compliqués) ; **deux origines avec façade publique même origine**, retenue.

## Décision recommandée

Noms **logiques**, domaines non achetés/configurés ici : `PORTAL_ORIGIN`, `ERP_ORIGIN`, `BACKEND_ORIGIN`, éventuelle origine de stockage privée. Les exemples du playbook ne prouvent pas leur propriété. Les URL réelles, certificats et environnements doivent être validés avant rollout.

- Navigateur ERP → `ERP_ORIGIN/api/*` → API Node existante. Refresh cookie **host-only**, pas de Domain parent, pas de partage de token ou de localStorage entre ERP/portail. Garder SameSite=Strict ; tester refresh/logout réel sous HTTPS.
- Navigateur public → `PORTAL_ORIGIN/api/public/*` → façade/proxy Node du portail Vite, borné → backend commun. SSR → backend par URL serveur configurée, sans cookie/Authorization de l’utilisateur. Jamais localhost dans le navigateur.
- Pas de proxy générique `/api/*`, pas d’URL upstream contrôlée par query/body. Allowlist stricte de méthodes et templates de routes publiques, encodage des slugs, bornes de taille/temps/réponse et protection SSRF. Refuser `/api/auth`, `/api/sync`, `/api/checkout`, `/api/users` et admin.
- Retirer Cookie/Authorization/Set-Cookie privés sur cette façade et ne jamais transmettre le secret auth ERP. Le suivi public utilise une **capacité distincte** limitée au RDV, pas la session Gérant.
- API publique accessible sans session privée mais jamais sans validation/anti-abus ; les fonctions internes ne déduisent pas un rôle de la présence du proxy.

Le proxy de production appartient à l’adaptateur HTTP Node/serverless ou au reverse proxy de déploiement ; `server.proxy` Vite ne suffit qu’au développement. `vite preview` ne remplace ni cette façade ni un serveur SSR de production. Les deux chemins doivent appliquer les mêmes allowlists et filtres.

## Origin, CSRF, CORS et proxy de confiance

Le navigateur n’a pas besoin de CORS cross-origin grâce à la façade. Ne pas ajouter `Access-Control-Allow-Origin: *` ou credentials sur le backend. Pour écritures publiques, la façade vérifie Origin exact `PORTAL_ORIGIN` et contexte fetch attendu avant de relayer ; le backend applique sa politique dédiée publique et limites. Origin n’est pas une authentification (un client serveur peut le forger) : il ne remplace pas capacités, validation, rate limit ni anti-bot.

Le proxy ne doit pas faire passer les écritures publiques par `assertSameOrigin` privé en leur inventant une origine ERP. Définir un contexte de proxy vérifiable côté serveur si nécessaire et une politique publique distincte ; ignorer les en-têtes forwarded arbitraires. Une requête privée continue de vérifier host/origin ERP et session réelle. Pas d’exception globale « domaines salonpro autorisés ».

Client IP/rate limit : établir le proxy de confiance et transmettre uniquement les métadonnées attestées par la plateforme ; un `X-Forwarded-For` injecté ne peut pas choisir son bucket. Cumuler limites par IP/slug/intention et protections globales bornées ; politique de conservation IP/empreintes à définir. Les appels SSR de lecture n’ont pas de cookie ; les mutations serveur sans Origin doivent avoir un protocole explicite, pas une exemption générale.

Les seuls échanges navigateur avec une autre origine sont les uploads signés vers quarantaine : CORS storage autorise uniquement les origines ERP réelles et méthodes/headers nécessaires, pas credentials ERP. Ajouter l’origine storage à `connect-src` ERP uniquement lors de ce lot. Diffusion média initiale même origine contrôlée, pas d’ouverture CSP à `https:` globalement.

## Capacités client et confidentialité

Référence RDV opaque non devinable mais non suffisante ; capacité secrète forte, hachée en DB, expirante/révocable, bornée à un RDV/action. Pas dans path/query/logs/analytics. Un lien de notification peut porter le secret dans le **fragment**, échangé contre preuve de suivi en mémoire ou cookie public host-only de portée étroite ; retirer le fragment de l’historique immédiatement, pas de tiers/analytics sur cette page, no-store et Referrer-Policy restrictive. Vérifier Origin/CSRF sur actions publiques si cookie de suivi utilisé. Ne pas copier ce mécanisme dans l’auth ERP.

L’accès anonyme à une référence seule ne divulgue aucun nom/contact/note ni l’existence d’un dossier privé. Notifications et logs ne doivent pas contenir les capacités en clair ; liens et destinataires protégés dans l’outbox, rétention et purge définies.

## Préviews et rollback

Deux projets distincts, URL HTTPS isolées et backend/DB recette dédiés ; aucune Preview autorisée via suffixe wildcard de tous les hôtes e2b/vercel. En déploiement, allowlists d’origines exactes par environnement et variables serveur privées. Le dev doit bind 0.0.0.0 et utiliser le proxy même origine ; l’acceptation large de hosts Vite actuelle n’est pas une politique CORS production.

SW ERP reste sur son origine ; pas de contrôle du portail ni de cache API. CSP/headers propres au portail React/Vite SSR, compatibles SSR sans rendre scripts arbitraires/inline globalement permissifs ; concevoir nonce/hashes si requis. `frame-ancestors`, HSTS et nosniff testés après déploiement, pas seulement dans JSON.

## Critères de validation

Navigateur HTTPS réel : login/refresh/logout ERP, cookies sans Domain parent, absence de cookie/token sur public/storage, proxy ne relayant aucune route privée, Origin étranger/referrer/CSRF refusés, public retry/cancel vérifié, tentative SSRF et en-têtes forwarded forgés rejetés, SW séparés et aucune page privée dans caches publics. Tests de sessions sur mobile et deux origines réelles avant Go.

Aucun DNS, secret, CORS, cookie, header ou projet distant modifié dans ce lot.
