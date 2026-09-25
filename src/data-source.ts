import 'dotenv/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataSource } from 'typeorm';
import { databaseSsl } from './config/database-ssl.js';

// En desarrollo este archivo corre desde src/ con ts-node (.ts) y en producción desde
// dist/ ya compilado (.js). Se busca solo la extensión que corresponde para no cargar
// los .d.ts que también quedan en dist/. Las barras se normalizan para que el glob
// funcione igual en Windows.
const currentFile = fileURLToPath(import.meta.url);
const baseDir = dirname(currentFile).replaceAll('\\', '/');
const ext = currentFile.endsWith('.ts') ? 'ts' : 'js';

// Mismo criterio que env.validation.ts (Joi): DB_PORT vale 5432 si no se define y DB_SSL es
// verdadero con "true" en cualquier combinación de mayúsculas. Así la app y las migraciones
// nunca se conectan de forma distinta con las mismas variables.
const dbPort = Number(process.env.DB_PORT || 5432);
const dbSsl = process.env.DB_SSL?.toLowerCase() === 'true';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: dbPort,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: databaseSsl(dbSsl),
  entities: [`${baseDir}/**/*.entity.${ext}`],
  migrations: [`${baseDir}/migrations/**/*.${ext}`],
});
