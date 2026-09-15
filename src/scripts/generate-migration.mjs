import { execSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const migrationsRoot = join(process.cwd(), 'src', 'migrations');
const srcDir = join(process.cwd(), 'src');

// 'common' agrupa lo que no pertenece a un solo feature (ej: el enum record_status,
// usado por varias tablas a la vez).
const SHARED = 'common';

function findEntityFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'migrations' || entry.name === 'node_modules') continue;
      results.push(...findEntityFiles(fullPath));
    } else if (entry.name.endsWith('.entity.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

// src/graphql/company/entities/company.entity.ts -> "company"
function featureNameFor(entityFilePath) {
  const entitiesDir = dirname(entityFilePath);
  return basename(dirname(entitiesDir));
}

function tableNameFromEntityFile(filePath) {
  const match = readFileSync(filePath, 'utf8').match(/@Entity\(\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

function pascalCase(slug) {
  return slug
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

const tableToFeature = new Map();
for (const file of findEntityFiles(srcDir)) {
  const table = tableNameFromEntityFile(file);
  if (table) tableToFeature.set(table, featureNameFor(file));
}
const featureOfTable = (table) => tableToFeature.get(table) ?? table;

// --- 1. Generar el diff completo con TypeORM (nombre temporal, se descarta luego) ---
const tempName = `Temp${Date.now()}`;

try {
  execSync(
    `npx typeorm-ts-node-esm migration:generate src/migrations/${tempName} -d ./src/data-source.ts`,
    { stdio: 'inherit' },
  );
} catch {
  process.exit(1);
}

const generatedFile = readdirSync(migrationsRoot).find((f) => f.endsWith(`-${tempName}.ts`));

if (!generatedFile) {
  console.error('TypeORM no generó ningún archivo (¿no hay cambios de schema pendientes?).');
  process.exit(1);
}

const generatedPath = join(migrationsRoot, generatedFile);
const raw = readFileSync(generatedPath, 'utf8');

// --- 2. Separar el diff en queries individuales de up()/down(), en orden ---
function extractMethodBody(source, headerRegex) {
  const header = source.match(headerRegex);
  if (!header) return null;
  const braceStart = source.indexOf('{', header.index + header[0].length - 1);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart + 1, i);
    }
  }
  return null;
}

function extractQueries(body) {
  const re = /await queryRunner\.query\(`([\s\S]*?)`\);/g;
  const out = [];
  let m;
  while ((m = re.exec(body))) out.push({ full: m[0], sql: m[1] });
  return out;
}

const upBody = extractMethodBody(raw, /public\s+async\s+up\([\s\S]*?\)\s*:\s*Promise<void>\s*\{/);
const downBody = extractMethodBody(
  raw,
  /public\s+async\s+down\([\s\S]*?\)\s*:\s*Promise<void>\s*\{/,
);

if (!upBody || !downBody) {
  console.error('No se pudo interpretar el archivo de migración generado por TypeORM.');
  process.exit(1);
}

const upQueries = extractQueries(upBody);
const downQueries = extractQueries(downBody);

// --- 3. A qué tabla(s) toca cada query, y qué tablas usan cada enum ---
// Postgres a veces califica los identificadores con el esquema (ej: DROP INDEX
// usa "public"."IDX_xxx", pero CREATE INDEX solo usa "IDX_xxx") — el esquema es opcional
// y solo nos importa el nombre real, que siempre es el último grupo entre comillas.
const ID = '(?:"[^"]+"\\.)?"([^"]+)"';

function tablesReferencedBy(sql) {
  const tables = new Set();
  for (const m of sql.matchAll(new RegExp(`(?:CREATE|ALTER|DROP)\\s+TABLE\\s+${ID}`, 'g')))
    tables.add(m[1]);
  for (const m of sql.matchAll(
    new RegExp(`(?:CREATE|DROP)\\s+(?:UNIQUE\\s+)?INDEX\\s+${ID}\\s+ON\\s+${ID}`, 'g'),
  ))
    tables.add(m[2]);
  return tables;
}

// DROP INDEX no menciona la tabla en Postgres; se resuelve buscando el CREATE INDEX que la creó.
const indexToTable = new Map();
const createIndexRe = new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+${ID}\\s+ON\\s+${ID}`);
for (const q of upQueries) {
  const m = q.sql.match(createIndexRe);
  if (m) indexToTable.set(m[1], m[2]);
}

const dropIndexRe = new RegExp(`DROP\\s+INDEX\\s+${ID}`);
function primaryTablesOf(sql) {
  const direct = tablesReferencedBy(sql);
  if (direct.size > 0) return direct;
  const dropIdx = sql.match(dropIndexRe);
  if (dropIdx && indexToTable.has(dropIdx[1])) return new Set([indexToTable.get(dropIdx[1])]);
  return new Set();
}

// enumName -> Set(tablas que lo usan como tipo de columna)
const enumUsage = new Map();
for (const q of upQueries) {
  const createTable = q.sql.match(/CREATE\s+TABLE\s+"([^"]+)"/);
  if (!createTable) continue;
  for (const m of q.sql.matchAll(/"public"\."([a-z0-9_]+)"/g)) {
    const set = enumUsage.get(m[1]) ?? new Set();
    set.add(createTable[1]);
    enumUsage.set(m[1], set);
  }
}

// Si un enum lo usa una sola feature, es suyo. Si lo usan varias (ej: record_status), es de "common".
function featureForEnum(enumName) {
  const owners = enumUsage.get(enumName);
  if (!owners || owners.size === 0) return null;
  const features = new Set([...owners].map(featureOfTable));
  return features.size === 1 ? [...features][0] : SHARED;
}

function featuresOf(sql) {
  const typeMatch = sql.match(/(?:CREATE|DROP)\s+TYPE\s+"public"\."([a-z0-9_]+)"/);
  if (typeMatch) return new Set([featureForEnum(typeMatch[1]) ?? SHARED]);

  const tables = primaryTablesOf(sql);
  if (tables.size === 0) return new Set([SHARED]);
  return new Set([...tables].map(featureOfTable));
}

// --- 4. Agrupar queries por feature, preservando el orden original ---
const featureUp = new Map();
const featureDown = new Map();

for (const q of upQueries) {
  for (const feature of featuresOf(q.sql)) {
    if (!featureUp.has(feature)) featureUp.set(feature, []);
    featureUp.get(feature).push(q.full);
  }
}
for (const q of downQueries) {
  for (const feature of featuresOf(q.sql)) {
    if (!featureDown.has(feature)) featureDown.set(feature, []);
    featureDown.get(feature).push(q.full);
  }
}

// --- 5. Orden topológico entre features: quién depende de quién (FKs y enums de "common") ---
const dependsOn = new Map();
function addDep(feature, dep) {
  if (feature === dep) return;
  if (!dependsOn.has(feature)) dependsOn.set(feature, new Set());
  dependsOn.get(feature).add(dep);
}

const referencesRe = new RegExp(`REFERENCES\\s+${ID}`, 'g');
for (const q of upQueries) {
  const ownFeatures = [...tablesReferencedBy(q.sql)].map(featureOfTable);
  for (const m of q.sql.matchAll(referencesRe)) {
    for (const f of ownFeatures) addDep(f, featureOfTable(m[1]));
  }
  for (const m of q.sql.matchAll(/"public"\."([a-z0-9_]+)"/g)) {
    const enumFeature = featureForEnum(m[1]);
    if (!enumFeature) continue;
    for (const f of ownFeatures) addDep(f, enumFeature);
  }
}

const allFeatures = new Set([...featureUp.keys(), ...featureDown.keys()]);
const order = [];
function visit(feature, stack = new Set()) {
  if (order.includes(feature) || stack.has(feature)) return;
  stack.add(feature);
  for (const dep of dependsOn.get(feature) ?? []) visit(dep, stack);
  order.push(feature);
}
for (const feature of allFeatures) visit(feature);

// --- 6. Un archivo de migración por feature, cada uno en su propia carpeta ---
rmSync(generatedPath);
const baseTimestamp = Date.now();

order.forEach((feature, index) => {
  // TypeORM a veces repite el mismo CREATE/DROP TYPE una vez por cada tabla que usa
  // ese enum (ej: record_status en 6 tablas) — se deduplica por texto exacto.
  const ups = [...new Set(featureUp.get(feature) ?? [])];
  if (ups.length === 0) return;
  const downs = [...new Set(featureDown.get(feature) ?? [])];

  const action = ups.some((q) => /CREATE\s+(TABLE|TYPE)/.test(q))
    ? 'add'
    : ups.some((q) => /DROP\s+(TABLE|TYPE)/.test(q))
      ? 'remove'
      : 'update';

  const featureDir = join(migrationsRoot, feature);
  mkdirSync(featureDir, { recursive: true });
  const existing = readdirSync(featureDir).filter((f) => f.endsWith('.ts'));
  const versionLabel = ((existing.length + 1) / 10).toFixed(1);

  // El timestamp incrustado en el nombre de clase es lo único que TypeORM usa para
  // decidir el orden de ejecución (lee los últimos 13 dígitos de `name`), por eso
  // cada feature recibe baseTimestamp + su posición en el orden topológico.
  const timestamp = baseTimestamp + index;
  const className = `${action.charAt(0).toUpperCase()}${action.slice(1)}${pascalCase(feature)}${timestamp}`;

  const content = `import { MigrationInterface, QueryRunner } from 'typeorm';

export class ${className} implements MigrationInterface {
  name = '${className}';

  public async up(queryRunner: QueryRunner): Promise<void> {
${ups.map((q) => `    ${q}`).join('\n')}
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
${downs.map((q) => `    ${q}`).join('\n')}
  }
}
`;

  const finalName = `V${versionLabel}_${action}_${feature}.ts`;
  writeFileSync(join(featureDir, finalName), content);
  console.log(`Migración creada: src/migrations/${feature}/${finalName}`);
});
