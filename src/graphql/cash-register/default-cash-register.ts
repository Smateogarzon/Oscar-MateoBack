// La caja que nace con cada tienda (LocationService.create): lleva el nombre de la tienda y el código
// C1. Después se renombra con updateCashRegister, o se agregan más cajas con createCashRegister.
export const DEFAULT_CASH_REGISTER_CODE = 'C1';

// El nombre de una sede admite 120 caracteres y el de una caja, 80.
const CASH_REGISTER_NAME_MAX_LENGTH = 80;
const FALLBACK_NAME = 'Caja principal';

export function defaultCashRegisterName(storeName: string): string {
  return storeName.trim().slice(0, CASH_REGISTER_NAME_MAX_LENGTH).trim() || FALLBACK_NAME;
}
