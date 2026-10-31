import { readFileSync, writeFileSync } from 'node:fs'
import { MIGRATIONS, MIGRATION_REGISTRY_SQL } from './migrations.ts'

const snapshot = '-- Généré par npm run db:schema — ne pas modifier directement.\n' +
  `${MIGRATION_REGISTRY_SQL};\n\n` + MIGRATIONS.map(({ id, sql }) => `-- ${id}\n${sql.trim()}\n`).join('\n')
if (process.argv.includes('--check')) {
  if (readFileSync('db/schema.sql', 'utf8') !== snapshot) {
    console.error('Schéma SQL obsolète : exécutez npm run db:schema.')
    process.exitCode = 1
  }
} else {
  writeFileSync('db/schema.sql', snapshot)
  console.info('Snapshot PostgreSQL généré depuis les migrations.')
}
