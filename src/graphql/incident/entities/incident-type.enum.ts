// Qué clase de novedad es. Varias todavía no tienen de dónde salir (ORDER_ISSUE, DELIVERY_ISSUE,
// SUPPLIER_ISSUE, CASH_ISSUE: pedidos, corredores y proveedores son de una fase futura), pero el
// catálogo ya las trae para no tener que migrar la columna después.
export enum IncidentType {
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
  NOT_FOUND = 'NOT_FOUND',
  DAMAGE = 'DAMAGE',
  WRONG_VARIANT = 'WRONG_VARIANT',
  LOSS = 'LOSS',
  UNREGISTERED_EXIT = 'UNREGISTERED_EXIT',
  UNREGISTERED_ENTRY = 'UNREGISTERED_ENTRY',
  ORDER_ISSUE = 'ORDER_ISSUE',
  DELIVERY_ISSUE = 'DELIVERY_ISSUE',
  SUPPLIER_ISSUE = 'SUPPLIER_ISSUE',
  CASH_ISSUE = 'CASH_ISSUE',
  OTHER = 'OTHER',
}
