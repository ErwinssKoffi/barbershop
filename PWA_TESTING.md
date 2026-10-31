# SALON PRO — installation, hors-ligne et mises à jour

## Déploiement

- Exécuter `npm ci && npm run build`. Le build génère `dist/sw.js`, son identifiant de version et la liste exacte des fichiers publics précachés avec intégrité SHA-256.
- Servir **tout le dossier dist** sur une origine HTTPS stable, avec les routes `/api` sur la même origine. Le worker nécessite HTTPS (localhost est une exception navigateur). Ne pas servir `sw.js` comme une page HTML.
- Sur Vercel, `vercel.json` configure la revalidation du worker. Sur un autre hébergeur : servir `/sw.js` en JavaScript avec `Cache-Control: no-cache, no-store, must-revalidate`, autoriser son scope `/`, et réserver `/api` au serveur, même pour les navigations.
- Les chemins sont volontairement absolus à la racine ; un déploiement sous `/sous-dossier/` n’est pas pris en charge.
- `npm run dev` n’enregistre pas de worker. Tester le build via `npm run preview`, idéalement sur l’origine HTTPS de préproduction, hors iframe.

## Ce qui est conservé

Le Cache Storage contient uniquement le shell public de ce build : HTML statique, chunks JavaScript, CSS, image de présentation, manifeste et icônes. Tous les chunks des pages différées sont précachés. Les requêtes de précache omettent les credentials ; chaque fichier doit passer son intégrité et les types HTML/JS/CSS sont vérifiés. Si un fichier manque ou est incompatible, l’installation échoue et la version précédente reste disponible.

Aucune réponse API, authentification, reçu généré, pièce jointe ou requête portant Authorization n’est capturée. Aucune file HTTP de mutations ni aucun jeton n’est enregistré dans le worker. Les données métier restent dans IndexedDB, via le dépôt existant ; la synchronisation continue de passer par l’API lorsqu’elle est disponible et que la session le permet. Pas de synchronisation en arrière-plan une fois l’application fermée.

Le cache de build ne remplace ni une sauvegarde métier ni une partition des données par compte/rôle. Ne pas placer de fichiers clients dans `public/images` : ce dossier est réservé aux ressources publiques livrées avec l’application.

## Mise à jour sans perte de saisie

Les pages contrôlées restent sur le même shell jusqu’à leur fermeture. Le worker ne fait ni `skipWaiting`, ni `clients.claim`, ni rechargement forcé. Une nouvelle version complètement téléchargée affiche une information invitant à terminer les saisies, fermer **toutes** les fenêtres de cette origine (application installée et onglets compris), puis rouvrir. La nouvelle version s’active alors et supprime les anciens caches SALON PRO ; les caches d’autres applications et IndexedDB ne sont pas supprimés.

Le navigateur vérifie également les mises à jour lors des visites. L’application demande une vérification au retour au premier plan, au retour réseau et toutes les heures. Le bouton Installer n’apparaît que si le navigateur émet son invitation ; sur iOS, utiliser le menu Partager → Sur l’écran d’accueil.

## Recette manuelle sur une vraie origine HTTPS

1. Charger la version A en ligne, ouvrir DevTools → Application → Service Workers. Vérifier l’activation puis rouvrir/recharger pour obtenir une page contrôlée. Vérifier manifeste et icônes 192/512.
2. Inspecter Cache Storage : aucun `/api`, aucune réponse financière ni donnée d’identité. Le contenu statique de l’application peut naturellement contenir des libellés et schémas métier.
3. Avec un compte réel autorisé, enregistrer une opération, attendre son enregistrement local et exporter une sauvegarde si nécessaire. Passer DevTools en mode Offline, recharger une route profonde puis ouvrir une page jamais visitée pendant cette session. Vérifier l’ouverture et la continuité locale existante ; aucun faux succès de sync Cloud ne doit apparaître.
4. Revenir en ligne : vérifier la synchronisation réelle et l’absence de doublons sur l’API déployée. `navigator.onLine` n’est qu’un indice de connectivité, pas une preuve d’accès à Supabase.
5. Déployer B sur **la même origine** pendant que A reste ouverte dans deux onglets. Garder un formulaire non enregistré. Vérifier que B attend et qu’aucune page ne se recharge. Terminer/enregistrer la saisie, fermer les deux onglets et toute fenêtre installée, rouvrir : B doit être active et les données locales préservées.
6. Déployer une version avec un fichier de build inaccessible en préproduction : son installation doit échouer sans remplacer le shell actif. Rétablir un build complet.
7. Tester Android/Chrome et Safari/iOS (installation, stockage, fermeture réelle des fenêtres), quotas et mode privé. Le système peut évincer les caches/IndexedDB : ne jamais considérer le stockage navigateur comme une sauvegarde durable garantie.

## Validation effectuée dans cet environnement

- Tests automatisés du worker généré dans un runtime simulé : précache public, credentials omis, exclusions API/Authorization/origines/mutations, navigation hors ligne, conservation de l’ancien cache si installation impossible et absence d’activation forcée.
- Tests React : statut réseau distinct de la sync Cloud et invitation d’installation sans promesse prématurée de cache prêt.
- Build servi via Vite preview : exécution du worker généré avec les vrais fichiers HTTP et intégrité SHA-256, 39 fichiers précachés, shell `/revenues` disponible après coupure du fetch simulée, API non interceptée.
- Ce dernier contrôle n’est **pas** un navigateur réel : installation OS, cycle multi-onglets, cookies HTTPS et éviction doivent encore passer la recette ci-dessus. Aucun Chromium n’est installé dans cet environnement.
