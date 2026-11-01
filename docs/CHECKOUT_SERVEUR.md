# Checkout serveur — devis (1a), finalisation (1b), file et pilote UI (1c)

**État : devis, commit et file durable implémentés ; migration 006 volontaire, formulaire serveur derrière un pilote désactivé par défaut.** Le parcours local reste le défaut ; le pilote n’est pas une activation de production. Ne pas traiter un devis comme un ticket accepté, une réservation ou un reçu officiel.

## API

`POST /api/checkout/quote`, `Content-Type: application/json`, Bearer d’une session individuelle vivante. Les rôles Gérant et Caissier utilisent le même calcul ; le tenant et le rôle sont relus depuis la session/membership. Aucun fallback PIN ni `tenantId` client pour cette route.

DTO : `src/domain/checkout.ts`. Validation/calcul : `server/checkoutQuote.ts`. Tests : `src/test/checkoutQuote.test.ts`.

Champs acceptés :

| Champ | Contrat |
|---|---|
| `idempotencyKey` | 16–128 caractères alphanumériques, `:`, `_`, `-` ; générée une fois par intention de ticket. **Non consommée par le devis** |
| `lines` | 1–100 lignes : `kind` service/product, `catalogId`, quantité entière 1–1 000 000, `variantId` de service facultatif, `employeeId` actif facultatif |
| `lines[].expectedUnitPrice` | Entier XOF optionnel : écart avec le catalogue → 409, jamais un prix imposé |
| `payments` | 0–20 parts nettes, montant entier strictement positif, mode actif configuré dans le salon ; un seul élément par mode |
| `discount` | Montant entier par ticket et motif non vide ; Gérant seulement pour une remise non nulle. Pas de remise supérieure au brut |
| `expectedTotal` | Contrôle optimiste du total ; l’écart est rejeté, pas adopté |
| `cashSessionId` | Caisse serveur de ce tenant, ouverte ; obligatoire pour toute part espèces |
| `amountTendered` | Facultatif si espèces ; couvre la seule part espèces. Ne remplace pas la somme nette des paiements |
| `clientName` | Facultatif, snapshot textuel 160 caractères maximum ; omettre pour une vente anonyme. Pas de modèle CRM ni de `clientId` accepté à ce stade |

Champs inconnus refusés, y compris `tenantId`, `total`, `receiptNumber`, prix arbitraire ou quantité de stock finale. Les montants calculés et agrégés restent dans les entiers sûrs JavaScript ; la répartition proportionnelle d’une remise utilise BigInt, puis distribue les unités résiduelles dans l’ordre des lignes pour une somme exacte.

Les consommables sont dérivés de `ServiceCatalogItem.defaultConsumables`, multipliés par la quantité de prestations et cumulés avec les produits vendus. Ils doivent être actifs et compatibles avec l’usage cabine/revente. Les consommables manuels du formulaire historique ne sont pas encore représentés par ce contrat ; aucune validation complète du formulaire n’est revendiquée.

## Résultat

```text
{
  ok: true,
  quote: {
    status: "quoted",
    confirmed: false,
    currency: "XOF",
    idempotencyKey,
    quotedAt,
    lines: [snapshots des libellés, variantes, prix, brut/remise/net],
    subtotal, discount, total,
    payments,
    cashAmount, change,
    stockRequired: [{productId, quantity}]
  }
}
```

- Somme des paiements = net exact ; somme des nets de lignes = net du ticket.
- `cashAmount` est la part nette en espèces, pas les espèces remises. `change = amountTendered − cashAmount` si fourni ; Wave/carte ne créent pas de mouvement espèces.
- Paiement entièrement non espèces possible sans caisse. Un net nul est possible avec paiements vides et remise Gérant motivée, ou prix catalogue nul.
- Pas de salaire, commission, note employé ni coût d’achat dans la réponse.
- Aucun reçu, écriture financière, delta métier ou avancement de curseur sync. Les mécanismes techniques de session/rate-limit restent actifs.
- Répéter une clé avec ce endpoint ne prouve aucune idempotence de vente : il ne fait que recalculer un devis. Un changement du catalogue/stock peut modifier/refuser le prochain résultat.
- Pas de réservation ni de verrou de vente. Le commit distinct reprend **toutes** les validations sous transaction ; il n’accepte pas aveuglément ce JSON.

## Erreurs principales

| HTTP / code | Signification |
|---|---|
| 401 `SESSION_REQUIRED` | Session absente/invalide ; sessions révoquées/tenants interdits utilisent aussi les erreurs du middleware commun |
| 403 `DISCOUNT_FORBIDDEN` | Remise Caissier refusée |
| 400 `INVALID_CHECKOUT`, `INVALID_CHECKOUT_AMOUNT` | Forme, champ, entier ou borne invalide |
| 400 `CHECKOUT_PAYMENT_MISMATCH` | Paiements incomplets/excédentaires |
| 400 `INVALID_CASH_TENDER` | Espèces remises incohérentes |
| 409 `CHECKOUT_PRICE_CHANGED` | Prix ou total attendu différent du calcul catalogue |
| 409 `CATALOG_ITEM_UNAVAILABLE`, `VARIANT_UNAVAILABLE`, `EMPLOYEE_UNAVAILABLE` | Référence absente/inactive ou hors tenant |
| 409 `PAYMENT_METHOD_UNAVAILABLE` | Mode non configuré/archivé |
| 409 `CASH_SESSION_REQUIRED`, `CASH_SESSION_UNAVAILABLE` | Caisse absente/fermée ou hors tenant |
| 409 `INSUFFICIENT_STOCK`, `STOCK_USAGE_MISMATCH` | Demande cumulée ou usage incompatible |
| 429 | Limite partagée DB par salon/utilisateur : 120 devis/minute ; `Retry-After` envoyé |
| 503 | Connexion serveur indisponible/non configurée |

Une erreur de devis ne modifie aucune écriture métier. Le client ne doit pas fabriquer une confirmation locale en réponse à cette erreur.

## Plan établi au lot 1a (avancement actualisé au lot 1b ci-dessous)

1. Après preuve de restauration : migration additive registre `(tenant, clé)` + hash normalisé + snapshot/résultat canonique, séquence de reçus tenant, contraintes et FORCE RLS/grants ; jamais appliquer le snapshot global à la main.
2. Commande de finalisation Gérant/Caissier : verrouillage sous vraie transaction, recalcul catalogue/rôle/caisse/stock, paiements, mouvements, reçu unique, auteur, réponse immuable. Rejeu identique → même résultat ; clé réutilisée pour une autre intention → conflit.
3. Interdire la mutation ou suppression des écritures de tickets confirmés par le vieux `/api/sync` ; sinon le nouveau chemin serait contournable. Les corrections deviendront des commandes inverses au lot 2.
4. File de commandes Dexie durable par espace, clé stable avant le premier envoi, état pending/confirmed/rejected, référence locale provisoire remplacée après acquittement, sans sauter de révisions du journal.
5. Adapter le formulaire existant et le reçu, d’abord Gérant puis Caissier. Aucun POST de finalisation en parallèle avec une création de lignes financières par l’ancien delta.
6. Tests transactionnels de tous les effets, double clic/rejeu après réponse perdue, rollback d’une ligne invalide, commandes concurrentes sur la dernière unité ; puis recette réelle HTTPS/Supabase avant GO.

## Finalisation transactionnelle — lot 1b (31 octobre 2026)

Le début de ce document décrit **le devis**, toujours sans effets. La finalisation est maintenant un endpoint distinct : **`POST /api/checkout/commit`**, avec le même DTO strict et une session individuelle vivante. Le formulaire par défaut reste local ; le pilote décrit ci-dessous envoie ses commandes via la file.

### Garanties implémentées

- Transaction `withTenantClient` sous rôle runtime/RLS et verrou `sync_state` du tenant, partagé avec les pushes historiques. Appartenance active et rôle relus dans la transaction ; acteur jamais fourni par le corps client.
- Recalcul catalogue, variantes, stock cumulé, remise et paiements par le calculateur commun. Aucun appel imbriqué au moteur de synchronisation ni de transaction partielle.
- Registre `checkout_commands` : clé primaire tenant/clé d'idempotence, hash SHA-256 du DTO normalisé à clés triées, acteur et résultat JSON persistés. Même commande et même acteur : résultat historique identique, même si le catalogue a changé ; aucun nouveau mouvement ni révision. Contenu différent : `409 IDEMPOTENCY_CONFLICT`. Autre acteur : `409 CHECKOUT_ACTOR_CONFLICT`. Une erreur de validation/persistance ne consomme pas la clé.
- Compteur transactionnel par salon et contrainte d'unicité tenant/reçu ; format réservé `SPC-0000000001`. Un rollback annule aussi le compteur. Le même numéro peut légitimement exister dans deux salons. Les anciens numéros locaux ne sont pas renommés.
- Dans la même transaction : recettes par ligne, répartition exacte des paiements sur les lignes, sorties produit/consommables avec liens réciproques, solde produit, mouvements des seules parts espèces et recalcul de la caisse depuis le journal. Le montant remis et la monnaie ne gonflent pas les entrées. Les autres paiements ne touchent pas le tiroir.
- Snapshots durables dans le résultat (commande, devis, libellés, variantes, catégories, prix, brut/remise/net, consommables/coûts, IDs d'employés et lignes financières). Les règles historiques de commission/paie et le snapshot nominatif complet des employés restent à compléter ; le registre n'est pas un module paie.
- Métadonnées serveur `checkout_records` indépendantes des champs déclarés par le client : sync refuse modifications/suppressions des recettes, mouvements de caisse/stock confirmés, faux IDs référençant leurs recettes/tickets et usage du préfixe officiel réservé. Un rejeu strictement identique reste un no-op. Triggers SQL interdisent aussi update/delete des lignes possédées par un checkout.
- La caisse utilisée ne peut plus être supprimée ni son fond/date d'ouverture réécrits ; les totaux de ses pushes historiques sont recalculés depuis les mouvements réels, pas adoptés du client. Sa clôture normale reste possible. Les corrections/refunds officiels ne sont **pas** encore implémentés : l'utilisateur doit recevoir un refus plutôt qu'une destruction silencieuse.
- Les triggers existants 005 journalisent les écritures métier dans le même commit ; les autres postes les récupèrent par delta. Aucun curseur permettant de sauter des changements intermédiaires n'est avancé artificiellement.

Réponse : `{ok:true,replayed:boolean,result:{status:'confirmed',confirmed:true,ticketId,receiptNumber,tenantId,actorId,confirmedAt,command,quote,records}}`. `quote` est le snapshot du calcul préalable (`quoted`, `confirmed:false`), **seul le résultat externe** confirme l'écriture durable. Les `records` donnent les recettes, produits, mouvements et éventuellement la caisse résultante. Le résultat de rejeu conserve les mêmes snapshots, pas un état courant de l'inventaire.

### Déploiement : migration volontaire seulement

`006_checkout` est additive et présente dans le snapshot de référence. **L'API et `npm run db:migrate` sans option appliquent seulement 001–005.** Une installation 005 continue à synchroniser ; commit répond `503 CHECKOUT_MIGRATION_REQUIRED` sans effets tant que la table canonique n'existe pas. La détection utilise le catalogue PostgreSQL (pas des droits de lecture supplémentaires sur le registre de migration).

Après preuve opérateur de sauvegarde **et restauration testée**, la CLI permet :

```sh
SALON_CHECKOUT_BACKUP_VERIFIED=true npm run db:migrate -- --include-checkout
```

Ce drapeau est une approbation explicite, **pas** une vérification automatisée de sauvegarde. Il n'est pas activé ni ajouté aux environnements par cette livraison. Pour le schéma privé Supabase, `supabase/optional/006_checkout.sql` est le paquet transactionnel généré depuis la même définition ; volontairement hors de `supabase/migrations` pour éviter une application automatique via `db push`. Ne pas exécuter le snapshot complet contre une base existante. Aucun DDL distant n'a été exécuté pour ce lot.

En cas de rollback applicatif, désactiver la route/bascule plutôt que supprimer le registre, le compteur, les métadonnées ou les triggers. Ne jamais restaurer une sauvegarde ancienne sur une base ayant de nouvelles ventes sans rapprochement : cela pourrait réutiliser des numéros ou perdre des écritures. Un ancien serveur peut rencontrer les triggers de protection ; privilégier un correctif compatible 006, pas une levée d'immuabilité.

### Recette et prochaines portes de sortie

Tests PostgreSQL embarqué : opt-in, atomicité avec panne injectée après les écritures financières, rejeu sans doublons/révisions, conflits de hash/acteur, rôles, paiements non espèces, stock, isolation de la même clé entre deux salons, révocation d'appartenance, protections sync/tombstones/SQL et recalcul de caisse. PGlite est une vraie exécution SQL/RLS **mono-connexion** ; ce n'est pas la preuve d'une concurrence multi-connexion hébergée.

À suivre avant bascule : file durable Dexie par intention, retry stable, acquittement atomique sans redébiter les projections locales, états pending/confirmed/rejected, reçus/UI et KPI adaptés, appels communs des deux rôles ; puis fermeture des créations financières arbitraires de la sync historique. Ces créations historiques restent possibles sous d'autres références : **la sécurisation globale de tous les chemins n'est pas terminée**. Les droits de correction inventaire et les autres flux de caisse/paie restent à unifier. Validation HTTPS/Supabase et sauvegarde/restauration restent bloquantes pour le GO production.

Validation finale locale de ce lot : **147/147 tests dans 25 fichiers**, schéma, lint, build et `git diff --check` OK. Ce résultat ne vaut pas recette de la base hébergée ni intégration UI.


## Lot 1c — file durable et pilote du formulaire commun

### Fonctionnement implémenté

- Dexie version 6 ajoute `checkoutOutbox` sans reconstruire les tables métier. Une intention est normalisée par le même validateur pur que le serveur, puis persistée avant tout envoi avec clé UUID stable, tenant, acteur, scope compte/rôle, commande et état `pending`. Une seconde sauvegarde avec la même clé/contenu est un no-op ; changer son contenu sous cette clé est interdit.
- Aucune recette, sortie de stock, entrée espèces ou référence officielle locale n’est créée par cette mise en attente. Les KPI et la disponibilité locale ne comptent pas cette intention ; le panneau précise que le stock n’est **pas réservé**. Les anciens KPI restent issus du cache, pas d’une lecture serveur temps réel.
- Le formulaire commun utilise cette voie seulement si `VITE_SERVER_CHECKOUT=true` au build. Les deux rôles ont le même branchement et un verrou immédiat contre la double soumission. Sans cet indicateur, le parcours historique reste inchangé. Après mise en attente, aucune ouverture de reçu provisoire présenté comme confirmé et aucun appel au créateur financier historique.
- Le pilote accepte les lignes catalogue, variantes, employé facultatif, paiements simples/fractionnés et client texte facultatif. Il bloque la saisie libre/prix imposés, désactive date rétroactive et note, masque les sorties cabine manuelles et explique que les standards sont dérivés par le serveur. La remise UI et le ticket gratuit restent à traiter dans le parcours final.
- `CloudSyncProvider` pousse d’abord les changements locaux existants (dont ouverture de caisse et catalogue), puis traite les commandes. Un aller-retour Cloud refusé/conflit empêche cet envoi ; pas de commit sur un état local non réconcilié. Après confirmation, le fournisseur relit le delta depuis son vrai curseur. Les préférences de sync/auto-sync restent respectées ; en mode automatique, un passage toutes les 30 secondes permet les réessais sans nouvelle mutation locale. Le bouton du panneau déclenche aussi la synchronisation manuelle.
- Bail durable de 120 secondes pour sérialiser les onglets ; après crash/expiration un autre passage reprend **la même clé**. Retry temporisé avec borne, respect de `Retry-After`, timeout réseau de 20 secondes pour l’appel commit. Une panne, 401, compte suspendu ou migration absente restent `pending`. Un refus métier connu devient `rejected`, sans nouvelle clé automatique. Une réponse incohérente/malformée reste en attente.
- Transport lié explicitement au tenant, UID et scope du compte : capture d’un jeton fixe après renouvellement éventuel, sans rejeu automatique d’un 401 avec le jeton d’un nouveau compte. Aucun secret de connexion DB dans le client. Une réponse tardive écrit uniquement dans l’ancien espace et ne dégrade pas une confirmation déjà acquittée sous un autre bail.
- L’ACK validé (tenant, acteur, commande, clé, statut et forme des records) est conservé atomiquement dans la file. **Il n’écrase pas les projections métier et ne change pas le curseur.** Le snapshot d’un ancien rejeu peut contenir un stock périmé : seul le journal Cloud ordonné met à jour ces projections. Une confirmation peut donc apparaître avant le chargement de ses montants dans les KPI.
- Le panneau dans le ticket affiche attente/rejet/confirmation et les derniers éléments, sans masquer la file si le pilote est ensuite désactivé. Un reçu confirmé peut être ouvert depuis le résultat canonique même si le pull financier n’est pas encore arrivé. Les anciens reçus ne sont pas requalifiés par le seul préfixe de leur numéro ; ils gardent la mention locale dans leur parcours historique.
- Une caisse locale ne peut être clôturée tant que ses intentions espèces sont pending, ou que les mouvements confirmés associés ne sont pas chargés/identiques. La création de commande et la clôture partagent un verrou transactionnel Dexie sur caisse/outbox pour éviter la course locale. Un autre poste peut néanmoins fermer sa caisse : le serveur reste autoritaire et peut refuser une intention offline.
- Import/remplacement et réinitialisation sont bloqués si une commande attend une confirmation. Les acquittements restent conservés après réinitialisation. La file est hors de la sync financière et n’est pas copiée lors d’un changement d’espace compte/rôle ; l’espace d’origine reste intact.

### Activation pilote et limites de sécurité/exploitation

Ne pas activer le pilote sur une base 005 : il conserverait des intentions en attente de 006. Après preuve de backup/restore, migration 006 volontaire et recette isolée, construire le client avec `VITE_SERVER_CHECKOUT=true`. Le drapeau ne contient pas un secret et ne remplace pas les contrôles serveur. Le laisser à `false` en production tant que les portes restantes ne sont pas satisfaites.

Le panneau n’est pas encore une page de supervision complète : pagination, résolution opérateur des intentions ambiguës/rejets, reprise après changement de rôle, export/restauration dédié de la file et visibilité globale restent à compléter. **Le JSON de sauvegarde métier n’inclut pas l’outbox**. Ne pas effacer IndexedDB/profil navigateur ni changer d’appareil pour « réessayer » une intention inconnue ; cela perdrait sa clé locale. La persistance IndexedDB ne garantit pas contre l’éviction, la suppression ou la panne de l’appareil, et n’est pas chiffrée.

La bascule n’est pas globale : autres formulaires et anciennes créations financières de `/api/sync` restent disponibles. Les corrections inverses, snapshots employés/commissions historiques, filtres globaux de KPI et compatibilité de tous les anciens clients restent ouverts. Le rapprochement après clôture par un autre poste et les scénarios multi-connexion/HTTPS hébergés ne sont pas prouvés. **No-Go production maintenu.**

### Preuves locales du lot 1c

**169/169 tests, 28 fichiers**, schéma/lint/build/diff OK. Vingt-deux nouveaux tests : 19 IndexedDB/transport (reprise, migration, scopes, bail et réponse tardive, refus/erreurs, clôture et reset), deux parcours UI Gérant/Caissier et un scénario complet Dexie → API → PostgreSQL → delta. Ce dernier simule réponse perdue après commit, une autre vente, puis rejeu ancien : aucune double sortie/recette et aucun stock récent écrasé. Les tests UI ne remplacent pas une recette navigateur HTTPS ni de vrais onglets multi-appareils.

## Lot 1d — supervision et récupération des intentions ambiguës

### Vérifier n’est pas renvoyer

`POST /api/checkout/status` accepte **seulement** `{idempotencyKey}` sous une session individuelle vivante. Après vérification de l’appartenance active, le serveur consulte le registre 006 sous le verrou tenant commun aux commits. Réponse :

- `{ok:true,status:'confirmed',result}` : résultat canonique original, uniquement à l’acteur propriétaire de la clé ;
- `{ok:true,status:'not_found',idempotencyKey,tenantId,actorId}` : aucune confirmation trouvée **à cet instant**, pas une annulation ni une preuve d’absence de paiement externe ;
- erreur 401/403/503 : pas de confirmation déduite, pas de détail financier livré à un autre acteur, pas de repli vers une création locale.

Cette route ne crée ni vente, ni mouvement, ni compteur/reçu, et ne consomme pas la clé ou une révision métier. Le rate-limit/session et, au besoin, l’initialisation technique de `sync_state` restent possibles. Elle ne remplace pas le commit par un faux « rejeu en lecture » : une clé absente ne déclenche **jamais** de finalisation. Le même jeton fixe lié au compte et le timeout réseau s’appliquent au transport status.

Le panneau du ticket devient une supervision locale avec compteurs, filtre attente/suspension/confirmation/rejet et pagination de dix intentions. Le contrôle individuel « Vérifier au serveur sans renvoyer » suspend l’intention sous bail avant le réseau. Résultat confirmé cohérent : ACK durable et reçu, sans réécrire les projections ni avancer le curseur. Absence : elle reste suspendue. Erreur ou contenu incohérent : elle reste suspendue, sans autorisation de reprise. Une vieille réponse ne remplace pas un résultat obtenu sous un bail plus récent. Les derniers contrôles/reprises sont conservés dans `reviewHistory` local ; ce n’est pas un journal serveur append-only ni une preuve cryptographique.

### Sauvegarde dédiée et restauration contrôlée

La sauvegarde **métier** continue à exclure la file. Le nouveau bouton « Sauvegarder les intentions non confirmées » produit un fichier distinct `SALON_PRO_CHECKOUT_OUTBOX_V1` pour les intentions pending/rejected du scope courant : clés originales, commandes, dates de création et état informatif précédent. Pas de token, cookie, bail, résultat confirmé ni projection financière. Les confirmations déjà connues restent conservées dans l’outbox locale et le registre serveur ; cet export ne prétend pas les sauvegarder ni remplacer un backup PostgreSQL.

- Restauration possible même dans une file vide, uniquement pour le **même salon/acteur/rôle déclaré** et un espace Cloud correspondant. Les champs non autorisés, faux résultats, mauvaises clés, doublons, formats ou volumes excessifs sont refusés.
- Limites explicites : 1 000 intentions et 5 Mo UTF-8. Pas de troncature silencieuse. Au-delà, garder l’appareil intact et organiser une sauvegarde opérateur.
- Toute restauration est atomique. Une clé existante avec un autre contenu annule l’import complet ; une clé identique/contenu identique est conservée sans toucher à son état, son ACK ou son bail.
- Une nouvelle intention importée devient **pending et suspendue**, jamais confirmée depuis le fichier. Son ancien état n’est pas une preuve de rejet ou confirmation. Les confirmations du serveur seront seules prises en compte. La restauration n’ouvre pas de caisse et ne crée aucune écriture métier.
- Le fichier est **privé, non chiffré et non signé**, avec potentiellement un nom client. Le scope déclaré empêche les mélanges accidentels ; ce n’est pas une authentification cryptographique de son origine. Un fichier modifié demeure une saisie non fiable soumise à tous les contrôles serveur et à une décision explicite de l’utilisateur.

### Procédure opérateur

1. Ne pas ressaisir un ticket dont l’issue est inconnue et ne pas lui inventer une autre clé. Sauvegarder la file avant suppression/changement d’appareil.
2. Sur le compte Cloud d’origine et le même rôle, ouvrir le ticket puis restaurer le fichier dédié. Les nouvelles lignes restent suspendues ; pas d’envoi automatique, même si auto-sync est actif.
3. Vérifier chaque intention au serveur. Si elle est confirmée, utiliser son reçu canonique puis synchroniser les écritures pour actualiser les KPI/stock/caisse.
4. Si le serveur ne trouve pas de confirmation et que l’intention est pending, décider après rapprochement des paiements réels : le bouton de reprise demande une autorisation explicite et conserve **commande et clé**. Le prochain passage de sync pourra alors finaliser si la clé n’a jamais été engagée, ou rejouer le même résultat si un autre poste l’a engagée depuis la vérification.
5. Un rejet métier déjà présent n’est pas réactivé par ce bouton. Une vérification non concluante, un conflit de contenu/acteur, un compte révoqué ou un changement de rôle exigent une intervention opérateur ; aucun bouton « supprimer/annuler/remplacer » n’est ajouté. Une intention importée depuis un ancien rejet n’est pas une preuve de refus serveur : sa reprise éventuelle nécessite elle aussi le contrôle puis l’autorisation manuelle.

La lecture status et la sauvegarde/restauration restent disponibles si le pilote d’envoi est désactivé. **L’autorisation de reprise UI est alors désactivée**, et le worker ne traite jamais les lignes suspendues. Aucune migration Dexie supplémentaire n’est nécessaire : champs optionnels sur la table v6, hors des projections financières.

### Validation et porte suivante

**190/190 tests, 31 fichiers**, schéma, lint (0 erreur/avertissement), build et diff OK. +21 tests : API/SQL status (4), sauvegarde/récupération/baux/transport (15), restauration/reprise et pagination/isolation UI (2). Les tests UI génèrent encore des avertissements React `act` non bloquants sur les notifications asynchrones ; les avertissements JSDOM des graphiques et taille de chunk restent également connus.

Aucun DDL distant ni activation de production. La récupération après changement de rôle/compte inactif et la supervision inter-acteurs ne sont pas implémentées ; la route ne donne pas un droit nouveau au Gérant sur les clés d’un autre acteur. La **fermeture globale des anciennes créations financières** de la sync et des autres formulaires reste l’étape suivante, avec prévol des clients/backlogs et stratégie de migration plutôt qu’un blocage destructif improvisé. Corrections inverses, recette HTTPS/multi-connexion, backup/restore hébergé et autres portes P0 restent ouvertes : No-Go production maintenu.

## Lot 1e — prévol et fermeture volontaire de la sync des ventes

### Politique serveur, désactivée par défaut

Deux variables **serveur**, sans secret :

```text
SALON_CHECKOUT_SYNC_MODE=legacy
SALON_CHECKOUT_CUTOVER_APPROVED=false
```

Le défaut reste `legacy`, sans changement de la politique historique. Pour une bascule opérateur, `enforced` exige **006 déjà installée** et `SALON_CHECKOUT_CUTOVER_APPROVED=true`. Sans ces prérequis, le push échoue en 503 sans effets ; une valeur de mode inconnue échoue également fermée. L’approbation est une décision de l’opérateur, pas un contrôle automatique de sauvegarde ou un recensement des postes.

En mode enforced, sous le verrou tenant et **avant** le calcul stock Caissier ou toute écriture métier :

- les nouvelles recettes, les changements de recettes historiques et les nouvelles suppressions de recettes via `/api/sync` sont refusés ;
- les créations/modifications/suppressions de mouvements stock/caisse identifiés comme effets de vente sont refusées, même sans recette jointe au push ;
- sont reconnus les liens de revenu/ticket/reçu, les types stock sale/use, les anciennes références inverses des recettes (mouvement espèces direct/split, sortie produit, consommables). Retirer un lien du mouvement entrant ne suffit donc pas à rendre modifiable un mouvement déjà référencé par une recette ;
- un snapshot identique (hors `updatedAt`) reste un no-op ; une suppression déjà enregistrée reste acquittable ;
- **le push entier est annulé**, y compris ses changements non financiers. Aucun pseudo-acquittement ni retour delta ne vient effacer/normaliser le backlog client. Le nouveau commit serveur ne passe pas par cette voie et reste disponible.

Cette fermeture vaut dans le moteur de sync, pas seulement dans l’UI : anciens clients, deux rôles et compatibilité PIN ne contournent pas le garde lorsqu’ils appellent ce moteur. Ce n’est **pas** une fermeture de toutes les mutations financières de l’ERP : mouvements manuels de caisse non liés aux ventes, dépenses/paie et corrections inventaire non commerciales conservent leurs voies historiques. Une écriture manuelle non liée ne peut pas être interprétée automatiquement comme une vente par son simple libellé. Ces domaines demandent leurs commandes/audits propres.

### Prévol authentifié, sans création financière

`POST /api/checkout/preflight` reçoit l’enveloppe de sync de l’appareil et renvoie `{ok:true,report}` : mode, présence de 006, approbation, `canSync`, nombre de blocages, IDs/table/opération et indicateur de troncature. Le calcul diagnostique les écritures qui seraient bloquées **même en mode legacy**, pour préparer la bascule. Aucun prix, nom client, libellé ni snapshot financier serveur n’est renvoyé.

La session individuelle et son appartenance active sont obligatoires ; tenant/acteur sont résolus par le serveur, pas choisis par le payload. RLS et verrou tenant s’appliquent. Le prévol ne consomme pas de reçu/clé/révision métier (session/rate-limit et initialisation technique de `sync_state` possibles). Il ne prédit ni toutes les validations RBAC/métier d’un push, ni la disponibilité future du stock. Le garde est **réexécuté au push** ; contourner ou ignorer le prévol n’autorise rien.

Limites : 10 000 lignes/suppressions examinées, 100 blocages détaillés maximum, compteur total et troncature explicite. Les recherches inverses dans les snapshots JSON sont à mesurer/indexer avant déploiement à grande échelle. Un gros backlog dépassant ces limites exige une procédure opérateur ; il n’est ni tronqué ni converti en nouvelles ventes.

### Protection de l’appareil avant le premier pull

Le client reconstruit son delta **avant toute lecture/merge Cloud**, effectue le prévol puis seulement, si autorisé, poursuit l’ancien flux push/pull et la file de commandes. En enforced, blocages, installation incomplète ou client sans `VITE_SERVER_CHECKOUT=true` arrêtent le passage sans pull/push. Le client ne fabrique pas de nouvelle clé pour les ventes héritées, ne réinitialise pas la baseline/cursor et ne traite pas ces ventes comme des ACK.

Le diagnostic local scope/date/nombre/IDs est conservé dans `workspaceMeta` et visible dans les détails du panneau. Ce n’est qu’un diagnostic du dernier passage **de cet appareil**, pas une vue en temps réel de tous les postes. Après un diagnostic enforced du scope courant, les quatre voies locales `createCheckoutTicket`, `addRevenue`, `updateRevenue` et `archiveRevenue` refusent de nouveaux changements hérités. La file reste utilisable. Ce garde local est seulement ergonomique : hors ligne avant la première découverte de la politique, ou avec un ancien client, des saisies locales peuvent encore exister ; le serveur les refusera sans les intégrer.

Les appels prévol/pull/push utilisent désormais le **jeton capturé pour ce passage**, avec vérification du compte courant avant chaque requête, sans rejeu 401 sous un compte remplacé. Une rotation ou un changement de compte pendant le passage provoque son arrêt ; il faudra recommencer sous la session courante plutôt que transmettre un payload déjà construit pour un autre espace. Un serveur trop ancien ne fournissant pas le prévol arrête également la synchronisation du nouveau client : déployer serveur/client ensemble.

### Ordre d’activation — ne pas sauter ces portes

1. Inventorier **toutes les instances serveur, tous les salons et tous les appareils** : les variables de ce lot s’appliquent au déploiement entier, pas à un tenant choisi dans l’UI. Prévol propre sur un appareil ≠ preuve globale.
2. Sauvegardes métier et files, backup PostgreSQL et restauration hébergée réellement testée ; vérifier l’hygiène/tombstones selon AGENTS avant de figer la politique.
3. Rapprocher en mode legacy les ventes héritées encore locales avec les vrais paiements et le registre Cloud. Ne jamais les réenregistrer automatiquement dans l’outbox avec de nouvelles clés : une ancienne vente peut déjà avoir été acceptée.
4. Déployer le serveur et les clients compatibles, appliquer 006 via sa procédure volontaire, activer le pilote UI et tester en environnement isolé. Conserver les originaux des appareils et les exports avant rapprochement.
5. Seulement après preuve opérateur, activer `enforced` + approbation sur **toutes** les instances. Une ancienne instance encore en legacy pourrait accepter une vente par l’ancienne voie. Surveiller les erreurs 409/503 et les diagnostics locaux, sans vider les données pour « débloquer » la sync.
6. Rollback : privilégier un correctif compatible et la suspension du pilote. Repasser volontairement le serveur en legacy rouvre les anciennes voies ; cela doit rester une décision opérateur auditée et non un fallback automatique. Garder registre/compteurs/triggers/ACK et rapprocher les écritures créées pendant l’incident.

Aucune variable n’a été activée dans l’environnement hébergé et aucun DDL distant n’a été exécuté. Les annulations/refunds par commandes inverses, la recette HTTPS/multi-connexion, l’administration inter-acteurs, les snapshots historiques complets et la qualification des autres chemins financiers restent des portes P0. **No-Go production maintenu.**

### Validation locale de 1e

**210/210 tests / 35 fichiers**, schéma à jour, lint 0 erreur/avertissement, build et diff OK. Vingt nouveaux tests : politique/API/SQL (9), prévol client (5), garde local/conservation backlog (3), transport capturé (3). Cas couverts : rollback global Gérant/Caissier, référence inversée sans lien entrant, rejeu no-op, tombstones, absence de 006/approbation, mode invalide, diagnostic borné et isolation tenant, backlog conservé et compte remplacé.

Les premières passes complètes ont révélé des délais intermittents de démarrage WASM PostgreSQL (budget de test 5 s) et de première transformation du module Dashboard (attente UI 1 s). Les modules ont été préchauffés dans la préparation des fixtures/tests : moteur jetable fermé avant chaque suite SQL, module réel Dashboard importé avant le parcours auth. Les bases par test, toutes les assertions et les budgets des assertions métier restent inchangés. La passe complète finale est verte ; cela ne prouve pas la cause de l’ancienne CI PR #2, qui n’a pas été relancée ici. Avertissements React act/JSDOM/chunk non bloquants connus conservés.

## Lot 2a — remboursement intégral serveur (31 octobre 2026)

**Implémenté et testé, non activé en production.** Migration locale optionnelle `007_checkout_refunds`, après 006. Aucun DDL hébergé exécuté pour ce lot.

### Contrat

- `POST /api/checkout/refund` : session individuelle et **Gérant actif** obligatoires, membership relue sous verrou transactionnel du salon. Le Caissier ne peut pas rembourser.
- Corps strict : `idempotencyKey`, `originalTicketId`, `reason`, `returnLineIds`, `paymentReferences`, et `cashSessionId` si le paiement original contient des espèces. Pas de prix, montant, rôle ou tenant fourni par le client.
- `returnLineIds` contient les identifiants de **recettes produit originales** à retourner, pas les identifiants du catalogue. Tableau vide = aucune remise en stock. Chaque ligne retenue revient intégralement ; jamais les consommables des prestations.
- `paymentReferences` : un objet `{method, reference}` pour chaque mode **non espèces** d'origine. Il s'agit d'une **attestation du Gérant**, pas d'une vérification ni d'une exécution du remboursement chez Wave, banque ou autre prestataire. Aucune transaction financière externe n'est simulée.
- Un remboursement intégral au maximum par ticket canonique du même salon. Les tickets legacy non canoniques ne sont pas éligibles à cette commande. Les montants et modes viennent exclusivement du résultat original immuable.
- Recettes et ventilations négatives avec liens d'annulation, reçu `SPR-…` sur le compteur partagé avec les ventes `SPC-…`. Motif et références conservés dans le registre. Le ticket original et son résultat restent inchangés.
- Les espèces sont sorties d'une caisse **actuellement ouverte et suffisamment provisionnée** ; elle peut différer de la caisse de vente désormais clôturée, dont la clôture reste inchangée. Les totaux sont recalculés à partir du journal.
- Retour produit au coût historique de la sortie originale, CUMP pondéré avec le stock présent, calcul intermédiaire BigInt et contrôle des bornes. Le coût consommé est contrepassé seulement pour les produits explicitement retournés ; les consommables restent consommés.
- Calcul des commissions fixes et unités salarié signé pour les inverses ; les pourcentages utilisent les montants négatifs. Les compteurs génériques de recettes restent des compteurs d'écritures, pas une nouvelle statistique commerciale de tickets nets.

### Atomicité, rejeu et supervision

Clé stable liée au salon, à l'acteur et au hash de la commande normalisée. Même intention = résultat mémorisé sans mutation ; clé réutilisée avec autre intention/acteur = conflit. Nouvelle clé pour le même ticket déjà remboursé = conflit. Toute panne annule stock, recettes, caisse, registre et compteur.

`POST /api/checkout/refund/status` accepte seulement `{idempotencyKey}` ; même Gérant actif et même acteur. Réponse `not_found` ou `refunded` avec résultat canonique, sans écriture financière. Une réponse perdue doit être vérifiée ou rejouée avec **la même clé**, jamais remplacée arbitrairement.

Les écritures inverses sont protégées contre modifications/suppressions SQL et sync/tombstones, ainsi que les faux liens de contrepassation. RLS forcée et droits runtime SELECT/INSERT sur les registres ; aucun accès navigateur direct. Les snapshots produits/caisse renvoyés sont historiques et ne doivent pas écraser aveuglément un état local plus récent.

### Installation volontaire et limites

`npm run db:migrate -- --include-refunds` inclut 006 et 007 et exige **les deux** attestations opérateur `SALON_CHECKOUT_BACKUP_VERIFIED=true` et `SALON_REFUNDS_BACKUP_VERIFIED=true`, uniquement après sauvegarde/restauration effectivement vérifiées. Ces variables ne constituent pas elles-mêmes une preuve de sauvegarde. Alternative Supabase privé : `supabase/optional/007_checkout_refunds.sql`, après 006 et les mêmes prérequis. Les migrations ordinaires excluent toujours 006/007. Sans 007 : API refund indisponible (503), aucune mutation.

**Hors périmètre de ce sous-lot :** interface remboursement, file/reprise offline dédiée, reçu imprimable d'avoir, remboursement partiel, intégration d'exécution des prestataires, migration des tickets historiques et validation hébergée. Le checkout pilote reste désactivé et le mode sync reste legacy. **Production No-Go** tant que les portes de sauvegarde/restauration, intégration et recette ne sont pas levées.

Validation : **221/221 tests, 36 fichiers**, 219,54 s (`.cache-refund-validated-tests.log`), dont 11 tests remboursement PostgreSQL/API ; lint, build, snapshot SQL et diff check verts. Une première validation avait révélé un oubli de curseur dans le test de clôture : corrigé en passant le curseur réel et en vérifiant zéro rejet de sync, sans assouplir les assertions métier.

## Lot 2b — interface Gérant et reprise manuelle durable

**Implémenté localement, derrière le pilote checkout désactivé par défaut.** Dans la file d'encaissement, filtrer les tickets confirmés puis utiliser **Gérer le remboursement SPC-…**. L'interface est réservée au Gérant actif et aux tickets canoniques disponibles dans la file de son espace local. Ce n'est pas encore une recherche serveur de tous les tickets du salon : les tickets d'un autre poste/compte ne sont pas automatiquement accessibles dans cette première interface.

Parcours :

1. Saisir le motif, sélectionner les lignes produit à remettre en stock, choisir une caisse actuellement ouverte si espèces et renseigner chaque référence externe attestée.
2. **Enregistrer la commande sans envoyer** : transaction Dexie dans `workspaceMeta`, clé unique stable par ticket/espace. Aucune recette, sortie caisse, remise en stock ni confirmation financière locale à cette étape.
3. Contrôler l'intention puis **Envoyer le remboursement avec la même clé**, après confirmation explicite. L'autorisation, les fonds et les snapshots sont revalidés par le serveur. Le solde du sélecteur de caisse est seulement indicatif.
4. La commande passe durablement à **issue incertaine avant l'appel réseau**. Une réponse perdue, un délai dépassé (20 s), un refus serveur ou un contenu inattendu ne crée aucune confirmation locale et n'autorise aucun changement de clé.
5. Après réouverture du même ticket/espace, **Vérifier le remboursement sans renvoyer** interroge uniquement le statut. Une confirmation valide est mémorisée ; `not_found` autorise une reprise explicite de la **même commande et même clé**, sans nouveau remboursement externe automatique. Un état confirmé ne peut pas être déclassé par un statut concurrent ancien.

L'envoi reste bloqué si `VITE_SERVER_CHECKOUT` n'est pas `true` ; la vérification seule reste possible. Session/claims/espace du Gérant sont capturés et vérifiés avant envoi ; une réponse reçue après changement de compte n'est pas reconnue localement. L'accusé doit correspondre au salon, acteur, ticket, clé, contenu et total conservés. L'échec de persistance bloque tout envoi. Deux préparations concurrentes du même ticket dans cet espace reprennent l'intention déjà enregistrée, jamais une nouvelle clé.

**Pas de projection des snapshots financiers renvoyés** dans Dexie : les mouvements sont chargés par la synchronisation Cloud normale. Le message de confirmation le rappelle ; il ne prétend pas que les indicateurs locaux sont déjà actualisés.

### Limites restantes et précautions

- Reprise **manuelle**, pas de worker ni de renvoi automatique au retour réseau.
- Intention enregistrée volontairement non modifiable, y compris après refus métier : correction supervisée à concevoir, sans supprimer/recréer la clé à l'aveugle.
- Suivi local dans l'IndexedDB du compte, **non inclus dans l'export de file des ventes**. Ne pas effacer les données du navigateur ; récupération sur autre appareil/export dédié non implémentés.
- Pas d'avoir imprimable, de remboursement partiel ni de recherche serveur multi-poste. Aucune exécution ou vérification de paiement chez un prestataire externe.
- Aucun changement de schéma supplémentaire : 007 reste volontaire et non appliquée à distance. Pas de déploiement, activation ou preuve nouvelle de sauvegarde/restauration ; **production No-Go maintenue**.

Validation lot 2b : **234/234 tests, 37 fichiers, 209,58 s**, dont 12 tests de persistance/UI/transport et un test supplémentaire reliant Dexie au vrai contrat PostgreSQL/API après réponse perdue. Lint (zéro avertissement/erreur), build, snapshot SQL et diff check verts. Journal `.cache-refund-ui-full-tests.log`.

## Lot 2c — avoir imprimable confirmé

Dans **Gérer le remboursement**, une intention `refunded` cohérente donne accès à **Avoir confirmé SPR-…**. Aucun avoir n'est disponible pour une intention préparée, incertaine ou `not_found`. Le document est relu depuis l'accusé serveur conservé, sans recherche de recettes legacy ni recalcul depuis le catalogue actuel.

### Contenu et garanties

- Numéro serveur SPR, reçu SPC d'origine, date de confirmation, identifiant du Gérant et motif conservé.
- Lignes de contrepassation, quantités annulées positives pour la lecture, montants signés négatifs ; **total remboursé positif** et contrepassation négative clairement distincts. Montants entiers XOF.
- Détail des modes d'origine, sortie d'espèces enregistrée en caisse et références externes **attestées par le Gérant**, sans prétendre exécuter ou vérifier ces paiements.
- Produits remis ou non remis en stock explicités ; consommables non restaurés. Aucune mention des espèces reçues ou de la monnaie rendue lors de la vente d'origine.
- L'identité du salon vient de la configuration **actuelle de l'appareil**, explicitement signalée ; elle n'est pas un snapshot légal de l'identité lors de la vente. Aucun nom/adresse fictif de substitution.

Avant affichage, `src/lib/refundReceipt.ts` contrôle l'espace, le tenant, le Gérant actif et l'acteur, la commande conservée, les références d'origine, les totaux, les signes, les liens de contrepassation, les ventilations de chaque ligne et leur concordance avec les paiements. Un résultat incomplet ou incohérent ne produit **aucun document de remplacement**. Cette vérification de cohérence d'un accusé stocké localement **n'est pas une signature cryptographique ni une preuve bancaire**, et n'effectue pas de nouvelle requête serveur à chaque impression.

### Impression et réimpression

Aperçus ticket **80 mm** et fiche **A5** ; choisir aussi le papier et les marges adaptés dans le dialogue du navigateur. Un portail dédié hors de l'application permet de masquer l'interface et d'imprimer seulement l'avoir. La classe d'impression est nettoyée sur `afterprint`, fermeture/démontage, changement de compte ou échec d'appel à l'impression. Réimprimer ne contacte pas l'API et ne crée/modifie aucun mouvement financier ; annuler le dialogue d'impression ne change pas le remboursement.

Le document porte un avertissement sur les paiements externes et ne revendique aucune certification fiscale. Il n'y a pas de stockage PDF serveur ni de numérotation d'avoir indépendante supplémentaire : le numéro SPR existant est réutilisé, sans mutation de la vente ou du registre.

### Validation et limites

**256/256 tests, 38 fichiers, 219,56 s** (`.cache-refund-print-full-tests.log`) ; lint zéro avertissement/erreur, build, schema check et diff check verts. 22 nouveaux tests couvrent le contenu historique, les refus d'affichage, les formats, le portail, la réimpression sans réseau/mutation, les erreurs et le changement de compte. Les tests de reprise UI et d'intégration réelle Dexie → API/SQL vérifient aussi l'éligibilité à l'avoir après récupération d'une réponse perdue.

Les appels navigateur d'impression sont simulés en JSDOM : **l'impression physique, la pagination et le rendu de chaque navigateur/imprimante restent à recetter sur matériel réel**. La recherche serveur multi-poste, l'export/import de reprise remboursement, la correction supervisée des intentions refusées et les remboursements partiels restent absents. Aucune migration supplémentaire, aucun DDL distant, aucun déploiement ni activation. **Production No-Go maintenue.**

## Lot 2d — sauvegarde et restauration des intentions de remboursement

Le panneau **Sauvegarde et reprise des remboursements**, réservé au Gérant actif dans la file d'encaissement, fonctionne indépendamment des tickets de vente locaux. Une intention restaurée reste donc accessible sur un appareil neuf où `checkoutOutbox` est vide. Cette section remplace la limite des lots 2b/2c indiquant l'absence d'export dédié ; la sauvegarde de file des **ventes** demeure distincte.

### Fichier et restauration

- Format JSON `SALON_PRO_REFUND_INTENTS_V1`, limité à **5 Mio / 1 000 intentions**, sans troncature ni changement automatique de clé.
- Export de toutes les intentions de l'espace, y compris celles déjà confirmées, mais seulement **commande originale, référence SPC et total attendu**. Aucun résultat, état confirmé, mouvement, snapshot métier, jeton ou secret de connexion n'est exporté.
- Fichier privé **non chiffré et non signé** : il contient motif, identifiants, montants attendus et références externes ; le protéger comme une donnée sensible. Il ne constitue pas une preuve de paiement ou de confirmation.
- Restauration autorisée seulement dans l'espace du **même Gérant, même salon et même rôle**, après connexion et liaison locale réelles. Aucun transfert de propriété vers un autre Gérant.
- Validation stricte du format, des champs, bornes, commandes et doublons. Transaction atomique : un conflit de ticket, clé ou contenu annule tout l'import. Une intention déjà présente et identique reste inchangée, y compris sa confirmation éventuelle ; aucune ancienne sauvegarde ne peut déclasser son état.
- Toute **nouvelle intention importée** démarre en état incertain, sans résultat et en **vérification seule**. Aucun envoi, aucune écriture financière et aucun avoir ne sont déclenchés par l'import.

### Reprise sur un autre appareil

1. Sur l'appareil source, télécharger la sauvegarde dédiée et la conserver dans un emplacement privé.
2. Sur l'autre appareil, se connecter avec le même compte Gérant et sélectionner le fichier dans **Restaurer une sauvegarde remboursement**.
3. Utiliser **Contrôler sans renvoyer SPC-…**. L'appel porte uniquement sur `/api/checkout/refund/status`, avec la clé d'origine.
4. Une confirmation serveur correspondant au compte, ticket, commande, référence et total conservés permet de récupérer l'état confirmé. Si son contenu est cohérent, **Ouvrir l'avoir récupéré SPR-…** fonctionne sans avoir importé la vente d'origine ni projeté les mouvements dans Dexie.
5. Si le résultat est absent, inaccessible ou incohérent, conserver l'intention et le fichier pour contrôle : **aucune confirmation importée et aucune nouvelle clé**.

### Limite volontaire : pas de réexécution depuis un fichier non signé

Même après `not_found`, **une intention nouvellement importée ne peut pas être envoyée**. Le total attendu du fichier est non fiable et la commande serveur actuelle ne porte pas de précondition de montant attendu. L'autoriser directement risquerait une exécution basée sur des métadonnées altérées. Cette garde est dans `operateRefundIntent`, pas seulement dans l'affichage des boutons.

La consultation du ticket canonique et une autorisation supervisée de reprise avec préconditions serveur restent à implémenter. Il ne faut pas contourner cette limite en effaçant les données, modifiant IndexedDB ou créant une nouvelle clé. Une intention native déjà présente n'est pas remplacée par la sauvegarde et conserve son parcours existant de vérification/reprise.

### Validation et état d'exploitation

**278/278 tests, 39 fichiers, 215,99 s**, journal `.cache-refund-recovery-full-tests.log`. Lint zéro avertissement/erreur, build, schema check et diff check verts. 22 nouveaux tests couvrent export sans accusés/secrets, import atomique, isolation, conflits, limites, conservation des états locaux, garde anti-renvoi, pagination et interface sur espace sans ventes. L'intégration réelle Dexie → PostgreSQL/API couvre maintenant export, restauration sur un second espace et récupération du statut puis de l'avoir sans seconde écriture.

Aucune migration supplémentaire, aucun DDL distant, aucune activation ou preuve de sauvegarde/restauration de la base hébergée. Ce fichier d'intentions **ne remplace pas une sauvegarde PostgreSQL vérifiée**. Production No-Go inchangée ; impression physique, recherche serveur multi-poste, correction supervisée, remboursement partiel et exécution prestataires restent à traiter.

## Lot 2e — contrôle canonique et reprise supervisée sous préconditions

Ce lot complète la garde du lot 2d : une intention importée **ne peut toujours pas être envoyée sur la seule base du fichier ou de `not_found`**, mais elle peut maintenant faire l'objet d'un contrôle canonique puis d'une reprise explicitement confirmée et protégée côté serveur. Aucun changement de clé ni correction silencieuse du fichier.

### Parcours Gérant

1. Restaurer l'intention puis **Contrôler sans renvoyer**. Si la clé est déjà confirmée, récupérer le résultat/avoir ; ne pas reprendre.
2. Après un statut authentifié `not_found`, choisir **Contrôler le ticket canonique SPC-…**. L'API relit le ticket immuable du salon et compare le montant et le reçu aux métadonnées conservées. Une différence bloque, sans adopter automatiquement le montant du serveur.
3. Relire les lignes historiques, quantités, total, modes, motif, retours produit, caisse et références externes. Le contrôle ne réserve aucun fonds/stock et n'exécute aucun paiement.
4. **Reprendre avec préconditions SPC-…** nécessite une confirmation explicite du Gérant et le pilote checkout actif. La même commande et la même clé sont transmises avec les préconditions du contrôle, sans modification du motif, des références ou de la caisse.
5. Le serveur revalide les préconditions et les règles métier sous le verrou transactionnel du salon. Après une réponse perdue, l'intention redevient incertaine : contrôle du statut obligatoire. Ce contrôle invalide l'ancien aperçu ; si la clé est encore absente, un nouveau contrôle canonique est nécessaire avant tout renvoi.

### API authentifiée

- `POST /api/checkout/refund/review` : `{command, expectedTotal, expectedOriginalReceiptNumber}`. Gérant actif uniquement, 007 requise, isolation tenant et limitation de débit. Renvoie `{ok:true, review}` : commande normalisée, lignes et modes historiques, total, référence et préconditions. Aucun mouvement, compteur de reçu ou recalcul persistant de caisse n'est écrit par ce contrôle financier en lecture seule.
- `POST /api/checkout/refund/resume` : `{command, precondition:{total, originalReceiptNumber, fingerprint}}`. Mêmes contrôles d'authentification ; exécution par le moteur atomique de remboursement existant.
- L'empreinte SHA-256 lie tenant, acteur, commande normalisée et résultat canonique original. Elle sert de **précondition de comparaison**, pas de jeton secret, de signature bancaire ou de preuve d'autorisation. Les droits sont toujours relus au serveur. Aucun délai d'expiration ou réservation n'est promis ; les ressources et droits sont revalidés à chaque exécution.
- Une différence de montant, reçu, clé, motif, retours ou attestation rend la précondition incohérente et bloque avant toute mutation financière. Un remboursement concurrent déjà confirmé bloque une seconde clé ; le rejeu exact de la même intention renvoie le résultat existant sans double effet.
- La caisse doit encore être ouverte et provisionnée lors de l'exécution ; le contrôle préalable n'autorise pas une sortie devenue impossible. Les règles de stock, retours, consommables et attestations externes restent inchangées.

Le champ local `verificationOnly` n'est pas supprimé : seules les intentions importées munies d'un contrôle cohérent et encore en état `not_found` peuvent utiliser le chemin `/resume`. L'export continue d'exclure ce contrôle et ses préconditions ; une nouvelle restauration impose de recommencer les vérifications. Le chemin de remboursement natif existant reste inchangé et n'est pas un point d'envoi utilisé par la reprise importée.

### Validation et limites

**294/294 tests, 39 fichiers, 232,60 s**, `.cache-refund-resume-full-tests.log` ; lint zéro avertissement/erreur, build, schema check et diff check verts. 16 tests supplémentaires : API review/resume, absence de mutation au contrôle, préconditions altérées, droits/fonds revalidés, remboursement concurrent, rejeu, réponses de contrôle incohérentes, confirmation UI annulée/acceptée, invalidation après réponse perdue et intégration sur second espace Dexie → PostgreSQL/API sans seconde écriture.

Une intention dont le fichier est incohérent, dont le ticket manque ou dont la caisse conservée est clôturée reste bloquée : correction supervisée de l'intention et changement de caisse non implémentés. La recherche serveur générale des tickets multi-postes, le remboursement partiel et l'exécution prestataires restent absents. L'impression physique reste à recetter. Aucune nouvelle migration ni DDL distant, aucun déploiement ou activation ; migration 007 toujours volontaire, **production No-Go maintenue**.

## Lot 2f — recherche et consultation des tickets multi-postes

Le panneau **Tickets serveur — tous les postes du salon**, dans la file d'encaissement, permet au **Gérant actif** de rechercher les ventes canoniques du salon, y compris celles encaissées par un autre compte Caissier ou sur un autre appareil. La consultation reste volontaire : aucune recherche automatique au montage, aucun import des ventes ou mouvements dans Dexie, aucune création dans la file d'encaissement.

### Recherche et API

- `POST /api/checkout/history/search` accepte uniquement `{receiptNumber?, from?, to?, cursor?}`. Numéro **SPC exact**, ou intervalle d'enregistrement serveur avec **deux dates UTC**, inclusif et limité à 366 jours. Les deux filtres peuvent être combinés ; sans filtre, les tickets les plus récemment enregistrés sont retournés.
- Réponse : `tenantId`, au maximum **20 résumés**, `nextCursor` ou `null`. Résumé : ticket, reçu, date de confirmation, acteur original, total et état du remboursement. Pas de recherche par nom client ni de total global.
- Pagination keyset descendante `(created_at, ticket_id)`, conservant la précision PostgreSQL **microseconde** dans le curseur. Pas de pagination par offset ni de conversion du curseur en millisecondes. Le bouton « Tickets suivants » reprend les filtres soumis ; relancer la recherche revient au début.
- `POST /api/checkout/history/detail` accepte seulement `{ticketId}` et renvoie le résultat canonique original ainsi que l'état de remboursement. Ticket absent du salon : 404, sans révélation de son existence ailleurs.
- Session individuelle, membership Gérant active, tenant actif et RLS forcée du rôle runtime à chaque requête ; POST uniquement, limitation de débit séparée search/detail. Champs inconnus (notamment tenant, rôle ou taille de page), dates invalides et reçus SPR interdits.
- 006 requise, aucune migration déclenchée par la consultation. Sans 007, les ventes restent consultables mais l'état remboursement est `unavailable`, jamais présenté comme « non remboursé ».

### Consultation puis éventuel remboursement

Le détail affiche les lignes et montants historiques ainsi que le compte ayant encaissé. Le reçu de vente peut être consulté depuis le résultat canonique. Le résultat n'est pas fusionné dans les recettes locales et ne remplace aucun snapshot local plus récent.

Si 007 est disponible et qu'aucun remboursement n'est enregistré au moment de la consultation, le formulaire Gérant existant permet de préparer une **intention de remboursement distincte**, avec motif, retours produits, caisse et attestations externes. La consultation et la préparation ne réalisent aucune opération financière ; l'envoi demeure derrière le pilote désactivé par défaut. Les validations et l'unicité du remboursement sont toujours revérifiées au serveur lors de l'exécution.

Un ticket déjà remboursé ne propose pas de nouvelle préparation dans ce panneau. Le reçu de vente original reste inchangé. L'état affiché n'est pas une réservation : un autre poste peut rembourser entre consultation et envoi, ce qui sera alors refusé par le moteur. L'avoir d'un remboursement effectué par un autre Gérant n'est pas automatiquement exposé ici : les règles existantes d'accès au statut/avoir du même acteur restent inchangées.

### Validation et limites

**317/317 tests, 41 fichiers, 247,22 s** (`.cache-checkout-history-full-tests.log`), lint zéro avertissement/erreur, build, schema check et diff check verts. 23 nouveaux tests : lecture Gérant d'une vente Caissier, absence de mutation, pagination sur 22 tickets ayant le même timestamp microseconde, bornes UTC, isolation, droits/migrations, annotations remboursement, validation des entrées, transport capturé/changement de session et préparation UI sans import financier ni envoi.

Tickets legacy non canoniques et rendez-vous exclus. Pas de recherche plein texte/client, d'export global, de navigation offline des résultats distants ni de recette de charge sur gros historique : **20 est une borne de réponse, pas une preuve de performance SQL en production**. Correction d'intentions refusées/changement de caisse, remboursements partiels, exécution prestataires et impression matérielle restent à traiter. Aucune nouvelle migration, aucun DDL/déploiement distant ni activation ; **No-Go production maintenu**.

## Lot 2g-a — diagnostic des intentions bloquées (premier sous-lot, sans correction)

Dans **Sauvegarde et reprise des remboursements**, le bouton **Diagnostiquer les blocages SPC-…** consulte les obstacles de caisse et de retour produit pour une intention non confirmée. Il fonctionne pour une intention native ou importée, sans l'envoyer et sans modifier état, clé, commande, contrôle canonique ou autorisation de reprise.

`POST /api/checkout/refund/diagnostic` accepte la même enveloppe que le contrôle canonique : `{command, expectedTotal, expectedOriginalReceiptNumber}`. Session Gérant active, tenant actif/RLS, validation stricte et limitation de débit dédiées. 007 est requise. Le ticket, le montant, les modes, les références et les retours demandés sont d'abord validés contre l'original. Une clé/ticket déjà remboursé impose de consulter le statut, pas de diagnostiquer une nouvelle exécution.

Le diagnostic renvoie la date de contrôle et des motifs explicites : caisse absente ou clôturée, solde insuffisant ou journal incohérent ; produit absent, snapshot de sortie absent, coût/quantité incohérent ou retour dépassant la limite de stock. Le solde espèces est **recalculé en lecture depuis le journal**, et non repris du total théorique éventuellement périmé de la caisse. Aucun recalcul n'est persisté, aucune clôture n'est réécrite et aucun produit n'est recréé. Les retours successifs du même produit sont cumulés pour vérifier la limite de quantité.

L'interface affiche le diagnostic en mémoire seulement, avec sa date et l'avertissement de non-réservation. Une réponse incompatible avec le compte, la commande ou les bornes est rejetée. **Zéro blocage détecté ne constitue pas une autorisation de rembourser** : les parcours existants de statut, contrôle canonique, confirmation et revalidation à l'exécution restent obligatoires.

**Ce sous-lot ne corrige pas l'intention** : pas de changement de caisse, motif, retours ou références, ni de nouvelle clé. La correction supervisée auditable annoncée reste donc partiellement implémentée ; la prochaine étape doit définir et enregistrer les corrections tout en conservant l'intention initiale et la protection contre une exécution concurrente.

Validation : **327/327 tests, 41 fichiers, 254,10 s**, `.cache-refund-diagnostic-validated-tests.log` ; lint sans avertissement/erreur, build, schema check et diff check verts. Dix nouveaux tests couvrent journal/caisse clôturée, stock impossible, droits/isolation/migrations, absence de mutation et d'autorisation, réponses incohérentes et diagnostic UI sans renvoi. Une première suite avait échoué sur un clic de test avant la fin de restauration : le test attend désormais explicitement que le bouton soit activé, sans augmenter les délais ni retirer d'assertion.

### Exécution locale à cette étape

Vite lancé sur **0.0.0.0:4173** avec `npm run dev -- --host 0.0.0.0 --port 4173 --strictPort`. Accueil vérifié HTTP 200 ; `/api/health` répond `ok:true` et **`databaseConfigured:false`**. L'interface est accessible dans l'aperçu mais les opérations Cloud nécessitent encore une connexion PostgreSQL d'exécution configurée côté serveur. Aucune donnée de démonstration ni aucun secret ajouté. Le serveur de développement n'est pas un déploiement de production.

Aucune nouvelle migration ni application distante de 006/007, aucune activation ou preuve de sauvegarde/restauration hébergée. **Production No-Go maintenue.**
