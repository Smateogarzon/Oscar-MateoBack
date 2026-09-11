import { execSync } from 'node:child_process';
import { readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const rawName = process.argv[2];

if (!rawName) {
  console.error(
    'Uso: npm run migration:generate -- accion_entidad  (ej: add_orders)',
  );
  process.exit(1);
}

const migrationsDir = join(process.cwd(), 'src', 'migrations');

const existing = (() => {
  try {
    return readdirSync(migrationsDir).filter((f) => f.endsWith('.ts'));
  } catch {
    return [];
  }
})();

const versionLabel = ((existing.length + 1) / 10).toFixed(1);
const className = rawName
  .split('_')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join('');

try {
  execSync(
    `npx typeorm-ts-node-esm migration:generate src/migrations/${className} -d ./src/data-source.ts`,
    { stdio: 'inherit' },
  );
} catch {
  process.exit(1);
}

const generatedFile = readdirSync(migrationsDir).find((f) =>
  f.endsWith(`-${className}.ts`),
);

if (!generatedFile) {
  console.error(
    'TypeORM no generó ningún archivo (¿no hay cambios de schema pendientes?).',
  );
  process.exit(1);
}

const finalName = `V${versionLabel}_${rawName}.ts`;
renameSync(join(migrationsDir, generatedFile), join(migrationsDir, finalName));

console.log(`Migración creada: src/migrations/${finalName}`);
