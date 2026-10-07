// Lo que el vendedor le pide a otro mientras el pedido avanza, sin cambiarlo.
//   HURRY      apurar: el cliente está esperando
//   ASK_STOCK  consultar a bodega por la existencia
//   CALL_RUNNER  contactar al corredor que lo lleva
export enum InternalOrderNudge {
  HURRY = 'HURRY',
  ASK_STOCK = 'ASK_STOCK',
  CALL_RUNNER = 'CALL_RUNNER',
}
