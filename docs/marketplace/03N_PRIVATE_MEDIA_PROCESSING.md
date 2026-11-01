# 03N — Traitement privé réel des images et contrat de stockage

1er novembre 2026 — suite du PROMPT 03 après publication textuelle. **Tranche technique locale**, pas une galerie opérationnelle en production.

## Livré

- Dépendance serveur `sharp` 0.35.5 et lockfile, pour décoder réellement JPEG/PNG/WebP ; le simple sniffing 02D ne vaut plus validation du contenu dans cette chaîne.
- Politique de traitement obligatoire, sans limites commerciales implicites : octets, pixels, dimension source, taille/dimension sortie, qualité et délai explicitement fournis par le futur opérateur/worker.
- Décodage dans un sous-processus Node à usage unique, annulable/tuable, sans secrets serveur dans son environnement ni erreurs du décodeur retournées. Flux stdin/stdout bornés ; concurrence locale limitée à deux décodeurs, sans file mémoire illimitée.
- Vérification taille/MIME déclaré vs signature puis format réellement décodé ; rejet des formats actifs SVG/HTML, signatures seules, fichiers tronqués, dimensions/pixels hors politique et animations multi-frame.
- Auto-orientation, redimensionnement sans agrandissement, réencodage WebP et suppression par défaut des métadonnées EXIF/ICC/XMP. Hashes SHA-256 de l’original et de la variante calculés sur les octets réels. Seule la variante optimisée serait candidate à publication.
- Contrat privé de stockage pour le worker, scopes tenant/média, méthodes de lecture d’original bornée, écriture immuable de variante et suppression idempotente. Aucun paramètre URL distante : pas de fetch externe/SSRF dans ce traitement.
- Adaptateur mémoire **réservé aux tests**, borné en objets et taille par objet, tenant-bound, sans persistance ni URL publique. Aucun fallback de production. La primitive de traitement refuse cet adaptateur si NODE_ENV=production.

Les images utilisées par les tests sont générées en mémoire pour tester le décodeur, jamais injectées comme photos de salon ni ajoutées au dépôt.

## Intégration PostgreSQL existante

`processStoredMedia` est une primitive privée **awaitée**, pas un handler HTTP qui démarre un travail puis retourne. Le pool est fourni par un environnement worker de confiance ; il doit pouvoir endosser le rôle média 012. Le navigateur ne fournit ni pool, ni scope d’autorité, ni preuve de décodage.

1. Contexte tenant et rôle média dérivé du schéma, transaction et verrou FOR UPDATE sur le média.
2. Si déjà ready, résultat idempotent sans nouvelle variante. Ce résultat confirme l’état DB, pas la présence physique de l’objet : une recette de réconciliation devra couvrir cette présence.
3. Si pending expiré, fermeture rejected et libération du quota via 021, sans lecture de stockage.
4. Transition pending → processing ; les triggers 021 revérifient le droit actif. Un tenant/droit non valable ne peut pas devenir ready.
5. Lecture bornée de l’original privé, décodage isolé, variante écrite sous une nouvelle clé opaque immuable ; accusé taille/hash comparé au contenu produit.
6. Variante 012 insérée, preuve source réelle enregistrée, transition ready et événements d’audit dans la même transaction.

Les octets restent hors PostgreSQL, Dexie, sync et sauvegardes JSON. **Aucune projection publique ou gate n’est ouvert par le traitement**. Aucune écriture de caisse, rendez-vous, prix ou utilisateur.

## Échecs et reprises

- Image invalide : processing → rejected, audit et libération du quota atomiques ; l’original reste privé dans l’attente d’une politique de purge.
- Incident de stockage, limite de concurrence ou indisponibilité de traitement : rollback, état pending conservé pour une reprise future, pas de faux ready.
- Accusé stockage divergent : refus ; variante compensée si possible avant tout COMMIT.
- Échec SQL/audit avant COMMIT : rollback et tentative de suppression de la variante privée de cet essai. Un échec de compensation peut laisser un objet privé orphelin ; aucun nettoyage fiable n’est prétendu livré.
- **Accusé COMMIT perdu : ne pas supprimer la variante**, car la transaction a pu réussir. L’issue est signalée incertaine ; une reprise lit l’état ready sans dupliquer la variante. Si le COMMIT a réellement échoué, une variante privée orpheline peut subsister : le futur réconciliateur doit vérifier les références DB avant toute purge.
- La transaction garde le verrou pendant le traitement borné. Une seconde exécution doit attendre la première puis relire son état ; concurrence réelle multi-connexion de cette nouvelle primitive encore à recetter.

Aucun claim processing durable n’est committé isolément avant le traitement : un arrêt de connexion avant COMMIT annule les mutations DB et laisse le média à reprendre. Cela **ne remplace pas** une file durable, un ordonnanceur ni une politique de retries/épuisement ; aucun consumer de production n’est lancé.

## Bornes techniques et limites d’isolation

Il n’existe pas de politique opérationnelle par défaut. Le parseur impose seulement des plafonds de sécurité maximums : entrée/sortie 16 MiB, source 40 millions de pixels et 12 000 px par dimension, sortie 4 096 px, qualité ≤95 et délai décodeur ≤30 s. L’exploitation doit choisir des valeurs plus adaptées et les valider avant activation. Cela n’ajoute ni forfait ni quota galerie ; le quota commercial reste 3 photos, régi par 021.

Le sous-processus désactive le cache sharp, limite libvips à un thread et le heap V8 à 128 MiB. **Le heap V8 n’est pas une limite de mémoire native/RSS**, et deux décodeurs par processus ne constituent pas une limite globale de déploiement. Le timeout parent et l’AbortSignal tuent le décodeur ; les requêtes DB ont leurs propres délais de verrou/statement (5/10 s). Les futurs adaptateurs doivent respecter le signal et borner leur lecture réseau : une interface TypeScript seule n’impose pas un timeout à un fournisseur défectueux.

Ce n’est pas une sandbox OS : limites cgroup/RSS/CPU, identité système minimale, réseau et fichiers restreints, mises à jour natives et tests de charge restent nécessaires au worker hébergé avant de traiter des fichiers non fiables en production. Aucun engagement de détection de malware, de contenu interdit ou de droit à l’image n’est prétendu. Le contenu est réencodé ; jamais de diffusion de l’original ou d’un EXIF brut.

## Stockage et déploiement non activés

Le contrat `PrivateMediaStorage` couvre ici **le traitement worker**, pas encore les intentions d’upload direct signé. Aucun fournisseur n’est choisi implicitement parce que la DB est Supabase. Pas de bucket, clé Storage, URL signée, upload navigateur, route publique d’image, écran galerie ou nouveau flag de production activé.

L’adaptateur mémoire n’est pas une solution de stockage local de production ; ses helpers sont explicitement nommés Test. Le discriminant kind évite un branchement accidentel, ce n’est pas une authentification contre un code serveur malveillant. Le futur adaptateur devra attester l’immutabilité/absence d’overwrite, la confidentialité et le checksum effectif des objets, pas renvoyer aveuglément le hash annoncé.

Aucune migration nouvelle : les métadonnées/cycle de vie 012 et droits/quotas 019/021 sont réutilisés. Aucun DDL distant, abonnement, publication réelle, secret ou variable Vercel modifié. La fonction n’est raccordée à aucun serveur public et aucun travail n’est lancé automatiquement après une requête.

Le worker `.ts` et les dépendances natives doivent être empaquetés et testés sur le runtime choisi. L’exécution Linux locale est vérifiée ; aucun fonctionnement serverless/Vercel ni paquet déployé n’est déduit du build Vite.

## Validation réelle

- **742/742 tests, 84 fichiers**, 719,00 s.
- Lint : 0 erreur/avertissement, 302 fichiers.
- Build/schema/diff : réussis ; avertissement existant 618,04 kB (gzip 183,62 kB).
- 15 tests ajoutés : 8 décodeur/stockage + 7 PostgreSQL/worker.
- Réels décodages JPEG/PNG/WebP dans un enfant Node ; orientation normalisée, absence EXIF/ICC/XMP sur la sortie vérifiée par sharp, animation WebP réellement à deux frames refusée, MIME trompeur/troncature/limites/annulation/concurrence locale.
- RLS/worker/cycle ready et audit exercés sur PGlite ; contenu corrompu/quota libéré, compensation stockage, état pending après erreur, COMMIT réussi avec accusé simulé perdu sans supprimer l’objet, refus inter-tenant/droit révoqué et test-adapter en production, intention expirée.

Ce n’est pas une recette Supabase Storage, un test de restore objet+DB, une preuve de concurrence multi-connexion ou une certification de sandbox native.

## Suite du plan

1. Choisir/valider fournisseur privé, limites opérationnelles, droits d’image et politique de conservation.
2. Intentions d’upload signées et quota réservé, réception idempotente et job durable ; adaptateur réel et tests de retries/crash/objets orphelins.
3. Galerie Gérant, retrait/tri/alt/crédit, publication uniquement de variantes ready et diffusion contrôlée no-store vérifiant le gate à chaque demande.
4. Portail Vite public, puis recette hébergée HTTPS/cache, concurrence et restauration coordonnée.

La publication textuelle 03M reste volontairement indépendante et désactivée par défaut. La porte PROMPT 03 « fiche et photos publiables » reste partielle. **No-Go production maintenu.**
