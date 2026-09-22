// La caja que nace con cada tienda (LocationService.create): lleva el nombre de la tienda y el código
// C1. Después se renombra con updateCashRegister, o se agregan más cajas con createCashRegister.
export const DEFAULT_CASH_REGISTER_CODE = 'C1';

// El nombre de una sede admite 120 caracteres y el de una caja, 80.
const CASH_REGISTER_NAME_MAX_LENGTH = 80;
const FALLBACK_NAME = 'Caja principal';

export function defaultCashRegisterName(storeName: string): string {
  return storeName.trim().slice(0, CASH_REGISTER_NAME_MAX_LENGTH).trim() || FALLBACK_NAME;
}

const CODE_PATTERN = /^C(\d+)$/i;

// El código de una caja lo pone el servidor y no se cambia: C1, C2, C3... en el orden en que nacen
// las cajas de una tienda. Sigue al más alto que la tienda haya usado —de cualquier caja, también
// de las desactivadas—, así un código nunca se reutiliza aunque su caja ya no esté en servicio. Los
// códigos que no tienen la forma C<número> (los que alguien escribió a mano cuando el código todavía
// se podía editar) no cuentan.
export function nextCashRegisterCode(usedCodes: readonly string[]): string {
  const highest = usedCodes.reduce((max, code) => {
    const match = CODE_PATTERN.exec(code.trim());
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `C${highest + 1}`;
}
