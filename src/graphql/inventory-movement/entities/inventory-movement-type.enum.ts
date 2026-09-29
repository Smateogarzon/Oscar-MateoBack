// Por qué se movió: para leer el kárdex, no cambia cómo se valida un movimiento (eso lo deciden
// from/to, no el tipo). PURCHASE/INITIAL_STOCK entran al sistema (sin from); SALE sale de él (sin
// to); los demás son traspasos entre dos inventory_locations.
export enum InventoryMovementType {
  PURCHASE = 'PURCHASE',
  TRANSFER = 'TRANSFER',
  SALE = 'SALE',
  RETURN = 'RETURN',
  ADJUSTMENT = 'ADJUSTMENT',
  DAMAGE = 'DAMAGE',
  RUNNER_PICKUP = 'RUNNER_PICKUP',
  RUNNER_DELIVERY = 'RUNNER_DELIVERY',
  DISPLAY_TRANSFER = 'DISPLAY_TRANSFER',
  INITIAL_STOCK = 'INITIAL_STOCK',
}
