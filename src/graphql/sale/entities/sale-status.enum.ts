// Ciclo de vida de una venta: nace en borrador, se completa al cobrarse y puede cancelarse
export enum SaleStatus {
  DRAFT = 'DRAFT',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}
