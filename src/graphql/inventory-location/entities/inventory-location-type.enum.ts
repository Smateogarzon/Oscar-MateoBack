// Dónde vive físicamente un lote de existencias. STOCK y DISPLAY están atados a una sede
// (bodega/trastienda y mostrador/vitrina); RUNNER es el inventario temporal de un corredor
// mientras transporta; TRANSIT, DAMAGED y RETURNS son "cajones" de paso o de cuarentena.
export enum InventoryLocationType {
  STOCK = 'STOCK',
  DISPLAY = 'DISPLAY',
  RUNNER = 'RUNNER',
  TRANSIT = 'TRANSIT',
  DAMAGED = 'DAMAGED',
  RETURNS = 'RETURNS',
}
