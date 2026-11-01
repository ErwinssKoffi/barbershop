import { readFileSync, writeFileSync } from 'node:fs'
import { MIGRATIONS, MIGRATION_REGISTRY_SQL } from './migrations.ts'

const snapshot = '-- Généré par npm run db:schema — ne pas modifier directement.\n-- Inclut 006/007/008/009/010/011/012/013/014/015/016/017/018/019/020/021/022 optionnelles : ne pas appliquer ce snapshot sans sauvegarde/restauration vérifiées.\n' +
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
