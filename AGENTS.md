# SALON PRO — Règles Permanentes d'Architecture et d'Hygiène des Données

Ces règles constituent le contrat d'ingénierie permanent du dépôt :

1. **Zéro donnée fictive (*mock / démo*)** :
   - Ne jamais injecter de jeux d'essai fictifs, de modèles récurrents pré-remplis, de bannières/badges « Démo » ou de valeurs d'identité fictives par défaut.
   - À l'initialisation (`src/db/seed.ts`), seules les catégories comptables structurelles du système sont créées ; l'identité du salon démarre vierge jusqu'à l'inscription du premier Gérant.

2. **Purge automatique et persistante pour tout compte réel** :
   - Tout compte réel (lors de l'ouverture de la base Dexie `version(4)`, de l'inscription, de la connexion, de l'import JSON ou de la synchronisation Cloud Neon) passe systématiquement par `src/domain/mockPurge.ts` et `SalonRepositoryHub.purgeLegacyMockData()`.
   - Les suppressions et *tombstones* sont **persistés durablement sur disque dans IndexedDB** (`syncTombstones` + `settings.dataHygieneVersion`) ainsi que dans PostgreSQL Neon (`sync_tombstones` sur les 14 tables métiers), sans jamais reposer sur un cache éphémère en mémoire vive.
   - Les comptes utilisateurs réels (`users` / `salon_users`) et les écritures réelles sont toujours intégralement préservés.

3. **Zéro code, PIN ou secret codé en dur** :
   - Aucun code PIN par défaut, mot de passe fictif ou clé HMAC codée en dur ne doit figurer dans `src/`, `server/`, `api/`, `.env` ou `.env.example`.
   - Le contrôle d'accès repose exclusivement sur l'authentification réelle (`PBKDF2-SHA-256` + jetons de session signés `HMAC-SHA-256`) et les rôles **Gérant** / **Caissier**.
   - Les secrets serveur (`DATABASE_URL`, `SALON_AUTH_SECRET`, `.salon-auth-secret`) restent strictement côté serveur et sont exclus de Git (`.gitignore`).

4. **Validation obligatoire à chaque modification** :
   - Exécuter systématiquement `npm run lint && npm test && npm run build` avant toute validation.
