import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// RDS con PostgreSQL 15+ rechaza conexiones sin cifrar. El certificado del servidor se
// verifica contra el bundle oficial de AWS, que la imagen Docker descarga al construirse.
const RDS_CA_BUNDLE = join(process.cwd(), 'certs/rds-global-bundle.pem');

export function databaseSsl(enabled: boolean) {
  return enabled ? { ca: readFileSync(RDS_CA_BUNDLE, 'utf8') } : false;
}
