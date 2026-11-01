# Recette Cloud, sécurité et fiabilité financière

## Lot du 1er novembre 2026

**État : préparation technique implémentée ; recette hébergée bloquée ; production No-Go.**

Ce document ne constitue ni une preuve de sauvegarde, ni un procès-verbal d’acceptation.
Les tests PostgreSQL WASM locaux ne remplacent pas une connexion Node → Supabase, une
recette HTTPS ou une vérification sur deux appareils réels.

### Vérifications externes réellement effectuées

- Projet Supabase BarberShop `pfiuujyybxtpoetdkmbc` : ACTIVE_HEALTHY.
- Lecture de `salon_pro.schema_migrations` : 001–005 seulement. Aucune migration exécutée.
- Catalogues : 28 tables dans salon_pro, dont 20 avec RLS activée et forcée. Ce total seul
  ne démontre pas l’isolation ; certaines tables d’identité sont protégées autrement.
- Vercel barbershop : seules les trois variables pilotes false/legacy/false sont présentes.
  `SUPABASE_DATABASE_URL` et `SALON_AUTH_SECRET` sont absentes. Aucune valeur déchiffrée.
- Vérification locale `npm run cloud:check` : `blocked`, configuration DB/clé manquantes,
  sécurité de base non vérifiée. Code de sortie attendu : 1.

## Outils livrés

```sh
npm run cloud:check
npm run cloud:check -- --financial
npm run test:financial
```

### Contrôle technique baseline

`cloud:check` charge les couches privées dotenv avec priorité aux variables injectées,
comme le serveur. Il lit aussi les variables publiques dans un instantané privé pour
repérer les secrets interdits et les pilotes du build, sans les injecter côté serveur.
L’instantané n’est jamais affiché.

Le rapport JSON ne contient que statuts, booléens, codes de blocage et contrôles manuels :

- présence d’une clé d’authentification d’au moins 32 caractères (pas une mesure d’entropie) ;
- absence des variables publiques interdites VITE_DATABASE_URL, VITE_SUPABASE_DATABASE_URL,
  VITE_SALON_AUTH_SECRET et VITE_SALON_SYNC_PIN (pas un scanner exhaustif de secrets) ;
- connexion SELECT 1 et registre des migrations existantes ;
- présence des 20 tables métier/synchronisation attendues avec RLS forcée et policy tenant_isolation ;
- changement réel vers le rôle runtime sans LOGIN, SUPERUSER ou BYPASSRLS ;
- cohérence des pilotes financiers.

Transactions **READ ONLY**, délai SQL local de cinq secondes, ROLLBACK et restitution du
client. Aucune migration, inscription, vente, donnée préremplie ou correction automatique.
Un échec ou une vérification impossible reste bloquant. Aucun endpoint public ajouté.

### Profil financier

Le profil `--financial` exige en plus :

- migrations 006/007 et leurs cinq tables avec RLS forcée ;
- présence des quatre triggers protect_checkout activés sur recettes, stock, mouvements et sessions de caisse ;
- alignement exact true/enforced/true des trois pilotes.

Ces vérifications de catalogue ne prouvent pas à elles seules le contenu des policies ou
des fonctions trigger, l’absence de droits excessifs, ni le comportement financier réel.
Elles complètent les tests comportementaux et la recette humaine ci-dessous.
Ne pas activer les pilotes en production uniquement pour obtenir un rapport vert.

`status:ready` signifie uniquement « contrôles techniques demandés réussis ».
**`productionApproved` reste toujours false**, même quand tout est vert. Les preuves de
restauration, les validations HTTPS et multi-poste ne sont pas attestées par cette commande.

### Connexions PostgreSQL durcies

Le caractère local est déterminé par le vrai hostname : localhost, 127.0.0.1 ou ::1.
Une mention de localhost dans les identifiants, la requête ou un nom distant ne désactive
plus TLS. Toute connexion distante exige un certificat vérifié.

Les paramètres URL sont normalisés : seul application_name est conservé. Les paramètres
ssl*, host, port, options et autres paramètres de requête ne peuvent pas remplacer les
options du Pool. Utiliser le hostname/port et les identifiants dans les composants standards
de l’URI. Le schéma Supabase reste salon_pro ; aucun repli sur public. Les options avancées
personnalisées en query string ne sont donc plus prises en charge. Ne pas contourner un
échec de certificat avec sslmode=no-verify ; corriger la chaîne de confiance côté serveur.

## Recette automatisée financière ajoutée

Sur une base PGlite isolée et jetable, sans données hébergées :

1. Deux connexions HTTP indépendantes du même Gérant.
2. Vente mixte prestation/produit, paiement espèces + Wave.
3. Réponse supposée perdue : consultation du statut depuis la seconde session.
4. Rejeu avec la **même clé**, même résultat et aucun double mouvement.
5. Refus de remboursement au Caissier sans mutation.
6. Remboursement par le Gérant puis rejeu depuis l’autre session sans doublon.
7. Rapprochement : recettes nettes 0, espèces nettes 0, une vente/un remboursement,
   solde initial de caisse conservé ; seule la revente choisie retourne en stock.

Wave reste une attestation externe : ce test ne réalise et ne simule aucun transfert bancaire.
`test:financial` regroupe également les tests existants d’atomicité/rollback, conflits de clés,
statut canonique, garde-fous de bascule, reprise locale et révocation de sessions.

## Portes de validation manuelle — toutes encore à vérifier

| Porte | Action / preuve attendue | État |
|---|---|---|
| Secrets | URI de recette isolée et clé forte renseignées en privé, aucune variable VITE sensible | Bloqué |
| Sauvegarde | Sauvegarde horodatée, inventaire des objets/rôles/policies et stockage privé | Non vérifié |
| Restauration | Restaurer dans une base isolée, comparer comptes/totaux et exécuter les contrôles ; consigner les écarts | Non vérifié |
| Migrations | Après restauration vérifiée : baseline, puis 006/007 volontaires uniquement en recette | Non exécuté |
| HTTPS | Authentification, cookie HttpOnly/Secure, refresh, logout et révocation inter-appareils | Non vérifié |
| Permissions | Caissier/Gérant, compte désactivé, salon distinct et refus des accès croisés | Non vérifié en Cloud |
| Vente | Paiement fractionné, consommables, reçu et stock rapprochés sur deux appareils | Non vérifié en Cloud |
| Réseau | Couper le réseau, conserver la clé, vérifier le statut avant toute reprise et absence de doublon | Non vérifié sur appareils |
| Remboursement | Permissions, attestation externe, avoir, mouvements inverses et rejeu idempotent | Non vérifié en Cloud |
| Clôture | Comptage réel, écart justifié et rapprochement moyens de paiement/espèces | Non vérifié en Cloud |
| Bascule | Tous les postes/backlogs rapprochés, opérateur identifié et PV signé | Non approuvé |

Pour chaque ligne : conserver date UTC, version Git déployée, environnement, responsable,
résultat attendu/obtenu et preuve privée expurgée de secrets. Ne pas versionner un dump ou
un export contenant des données personnelles. Ne pas créer de fausses écritures sur une
base de production pour les besoins d’une démonstration.

## Arrêt et retour arrière

- À la moindre incertitude : arrêter la bascule et les nouvelles écritures concernées,
  conserver les files locales et les clés originales ; consulter le statut canonique.
- Ne pas remettre legacy après des ventes serveur confirmées : cela réautoriserait les
  écritures historiques. Ne pas supprimer 006/007 ou leurs journaux pour revenir en arrière.
- Le rollback applicatif doit conserver les protections et l’accès aux diagnostics.
  Une restauration de base exige un plan validé qui tient compte des écritures postérieures.
- Réouvrir la porte de production uniquement après les preuves humaines ci-dessus.

## Rapprochement financier dans l’application — lot suivant

**Paramètres → Cloud PostgreSQL → Vérifier les écritures Cloud**, Gérant actif uniquement.
Aucune requête automatique à l’ouverture et aucun résultat de remplacement issu de Dexie.
Le rapport n’est pas enregistré en base ou dans le navigateur ; il est horodaté et effacé
au changement de compte ou lors d’une nouvelle vérification. Un changement de jeton pendant
la requête invalide sa réponse, même pour le même compte.

L’endpoint `POST /api/checkout/reconciliation` accepte uniquement `{}`. Le salon et le rôle
proviennent de la session serveur, jamais du corps. Limite : six contrôles par minute et
compte/salon. Le contrôle revalide le Gérant dans sa transaction et reste sous le rôle
runtime avec RLS. Réponse no-store, compteurs seulement, aucune identité client/employé.
Les écritures de sécurité usuelles (limitation de débit/authentification) sont distinctes
du rapprochement : **aucune écriture financière**, correction ou migration dans ce contrôle.

### Périmètre des six vérifications

1. Totaux des tickets serveur : correspondance recettes signées, paiements et métadonnées
   canoniques ; montants entiers XOF dans les limites sûres.
2. Recettes, mouvements de stock et de caisse : présence des écritures attendues,
   égalité des payloads avec les snapshots confirmés, cohérence des colonnes financières.
3. Rattachements checkout/refund à des écritures réellement attendues.
4. Soldes de toutes les sessions de caisse du salon : ouverture + entrées − sorties,
   projections du payload, total des entrées/sorties et écart de comptage à la clôture.
5. Mouvements de caisse dont la session est absente du salon.
6. Mouvements de caisse de type/montant invalide ou incohérents avec leurs colonnes.

Tous les SELECT s’exécutent dans une **unique transaction REPEATABLE READ READ ONLY**,
avec délai SQL de cinq secondes et ROLLBACK, pour éviter de comparer des instants différents.
Une donnée impossible à interpréter ou un timeout donne « contrôle indisponible », jamais
un résultat vert. Le contrôleur ne tente pas de rendre des données invalides acceptables.

### Sens des statuts et limites

- `balanced` : aucun écart détecté sur ce périmètre, avec tables de remboursement présentes.
- `discrepancies` : au moins un compteur d’écart non nul. Une ligne peut contribuer à plusieurs
  vérifications ; ne pas additionner les compteurs comme un nombre unique d’incidents.
- `incomplete` : aucun écart détecté sur la partie disponible, mais 007 absente.
- Sans 006 : refus 503, sans création de table.

Les contrôles portent sur les ventes/remboursements canoniques, et sur les sessions/journaux
de caisse, y compris historiques. Ils **ne certifient pas** toutes les recettes historiques,
l’exactitude de l’inventaire actuel, le comptage physique, les commissions, les files locales
non confirmées, les écritures externes ou un transfert bancaire/Wave. Ils ne constituent
pas une détection cryptographique de toute falsification privilégiée des snapshots.

Un résultat sans écart n’autorise ni une bascule ni la production. En cas d’écart : conserver
les preuves et les clés, examiner les tickets/journaux avec le Gérant ; aucune suppression,
réécriture ou nouvelle vente ne doit servir à masquer une incohérence.

### Validation locale du lot de rapprochement

- **373/373 tests dans 47 fichiers**, 359,02 s ; lint, build, schema check et diff check verts.
- Tests de vente/remboursement sans mutation, couverture 007 absente, accès et isolation,
  colonnes altérées, rattachements manquants, mouvements orphelins/invalides, clôture,
  limitation de débit et rejet PostgreSQL d’une écriture injectée (SQLSTATE 25006).
- Interface/transport : jeton capturé, périmètre refusé, compteurs/statut invalides rejetés,
  réponse tardive ignorée, effacement d’un résultat après échec ou changement de compte.
- Aucune preuve de connexion Cloud réelle, de restauration ou de recette multi-appareils
  supplémentaire acquise par ces tests locaux. Aucune mutation du schéma hébergé.
