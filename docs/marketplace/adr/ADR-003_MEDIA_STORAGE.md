# ADR-003 — Stockage média privé et diffusion contrôlée

- Date : 2026-11-01.
- Statut : **PROPOSÉ — fournisseur et limites à valider**.
- Liens : [architecture](../01_TARGET_ARCHITECTURE.md), [projection](ADR-002_PUBLIC_READ_MODEL.md).

## Contexte / options

Le logo ERP historique est une Data URL dans `SalonInfo`, lu par FileReader et inclus dans les données privées synchronisées. Ce n’est ni un upload sécurisé ni une galerie. Ne pas casser ce fonctionnement ni copier automatiquement ce logo vers un profil public.

Comparer : objets publics/CDN directs (simple mais révocation/cache difficiles) ; upload relayé via fonction Node (limites de payload/temps et consommation mémoire) ; **upload direct signé vers stockage objet privé**, retenu. Supabase Storage et un fournisseur S3-compatible restent candidats ; présence de Supabase DB ne prouve ni bucket, ni droits Storage, ni capacité de transformation. Fournisseur, région, coûts, accords et quotas ne sont pas choisis par cette ADR.

## Décision recommandée

1. Gérant authentifié, membership et entitlement vérifiés ; intention persistée avec taille/type annoncés et quota **réservé atomiquement**. Aucune confiance dans les données annoncées pour accepter le contenu.
2. Clé objet opaque générée serveur, tenant résolu côté serveur. Signature courte bornée à l’objet, opération et limites du fournisseur ; pas de wildcard, pas de nom de fichier utilisateur comme chemin, pas d’accès list/read/delete navigateur.
3. Upload dans une zone privée de quarantaine. `complete` idempotent constate seulement la réception et déclenche un travail fiable.
4. Worker borné CPU/mémoire/temps : MIME réel et décodage, taille/dimensions/pixels, détection des contenus invalides, retrait EXIF, réencodage de variantes, contrôles de contenu retenus selon risque. Extensions annoncées seules insuffisantes. SVG/HTML et formats actifs non acceptés au MVP.
5. Métadonnées tenant-scoped : état `pending/processing/ready/rejected/deleted`, hash, objets/variantes, dimensions, ordre/rôle logo/couverture/galerie, crédit/alt/consentement, version et audit. Seules variantes `ready` sont publiables, jamais l’original.
6. Quotas réservés libérés selon état final/expiration, reprise après crash et nettoyage idempotent des intentions orphelines. Supprimer d’abord les références publiées/gate concerné puis purger les objets via tâche fiable ; aucun objet supprimé sous une autre clé/tenant.

Le worker ne doit pas continuer seulement en mémoire après une réponse serverless. Choisir en phase d’implémentation une file/claim durable et l’adaptateur de traitement ; tests de retries et concurrence avant usage réel.

## Diffusion et révocation

Au MVP, origin objet privé ; endpoint public média vérifie l’éligibilité publication à chaque requête et ne sert que la variante autorisée, `Content-Type` fixe, `nosniff`, `Cache-Control: no-store`. Pas de redirection vers URL bucket permanente. Endpoint borné en types/tailles/débit, sans paramètre URL distante (pas de SSRF), range/transform arbitraires refusés. Aucun cookie ERP transmis au stockage.

Ne pas laisser un optimiseur d’images ou un CDN mettre en cache cette diffusion et contourner la dépublication. Variante optimisée au worker, rendu sans optimiseur recachant au MVP. Si passage ultérieur à URLs signées/CDN, documenter le délai maximal de révocation et prouver purge/expiry ; nouvelle validation requise. Les copies externes déjà récupérées ne peuvent être garanties effaçables.

## Conséquences / critères

- Plus de coût proxy/egress et d’exploitation worker que des objets publics ; mesurer avant montée en charge.
- Nouveaux médias hors Git, hors PostgreSQL binaire, hors sync complète/Dexie/JSON backups ; backup objet + métadonnées et restauration coordonnés à définir.
- Droits d’image, politique de rétention, limite galerie et procédure de retrait à valider ; aucune valeur commerciale par défaut inventée.
- Tests : MIME trompeur, fichier corrompu/bombe pixels, clés cross-tenant, upload expiré/rejoué, quota concurrent, original privé, cleanup après crash, dépublication pendant diffusion, suppression relancée et absence de métadonnées privées.

Pas de bucket, URL signée, clé fournisseur, dépendance ou upload créé dans le PROMPT 01.

## Avancée 03N — Traitement implémenté, fournisseur toujours non choisi

Le décodage réel, le retrait des métadonnées et le réencodage WebP sont maintenant implémentés avec sharp en sous-processus privé borné en délai, pixels et concurrence locale. La primitive transactionnelle réutilise 012/019/021 pour état/variante/preuve/audit. Un contrat worker et un adaptateur mémoire explicitement réservé aux tests sont livrés, sans fallback de production. Les limites opérationnelles restent à fournir explicitement ; les plafonds techniques ne sont pas une nouvelle décision commerciale.

La recommandation d’upload direct signé privé reste inchangée : aucun fournisseur, bucket, signature d’upload ou interface de galerie n’est activé. La primitive awaitée n’est pas une file durable ni un service de production ; sandbox OS/RSS natif et réconciliation des objets après crash/COMMIT incertain restent requis. Le statut global de l’ADR reste proposé pour ces décisions d’exploitation. Détails et preuves : [03N](../03N_PRIVATE_MEDIA_PROCESSING.md).
