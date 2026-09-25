// Puerta para los `down` de migraciones que borran datos reales (tablas, columnas o filas de
// negocio) y no se pueden deshacer: sin ALLOW_DESTRUCTIVE_DOWN=1 el revert se detiene antes de
// tocar nada.
// Vive en config/ y no en migrations/ a propósito: TypeORM carga como migración toda función que
// exporte un archivo de migrations/, y esta fallaría al leer el timestamp de su nombre.
export function assertDestructiveDownAllowed(name: string): void {
  if (process.env.ALLOW_DESTRUCTIVE_DOWN === '1') return;

  throw new Error(
    `Revertir ${name} borra datos reales (tablas, columnas o filas) y no se puede deshacer. ` +
      'Haz antes un respaldo de la base y, si de verdad quieres revertirla, repite el comando con ALLOW_DESTRUCTIVE_DOWN=1.',
  );
}
