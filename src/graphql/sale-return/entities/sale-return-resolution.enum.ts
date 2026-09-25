// Cómo se resuelve una devolución. Al pedirla el cajero elige REFUND (se devuelve el dinero) o
// EXCHANGE (el cliente se lleva otro producto). Un cambio por algo más barato pasa solo a
// PARTIAL_REFUND cuando se cobra la venta nueva y sobra crédito, que se devuelve en dinero.
export enum SaleReturnResolution {
  REFUND = 'REFUND',
  EXCHANGE = 'EXCHANGE',
  PARTIAL_REFUND = 'PARTIAL_REFUND',
}
