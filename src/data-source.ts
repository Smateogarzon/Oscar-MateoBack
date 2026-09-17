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

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: databaseSsl(process.env.DB_SSL === 'true'),
  entities: [`${baseDir}/**/*.entity.${ext}`],
  migrations: [`${baseDir}/migrations/**/*.${ext}`],
});
