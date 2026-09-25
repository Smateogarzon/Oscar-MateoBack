import { assertDestructiveDownAllowed } from './destructive-down.js';

// Puerta del script `migration:revert:prod`: revertir en producción exige ALLOW_DESTRUCTIVE_DOWN=1
// aunque la migración a revertir no borre nada. Se compila a dist/config/require-destructive-ok.js.
try {
  assertDestructiveDownAllowed('la migración en producción');
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
