// Los tipos de orden del modelo operativo, cada uno con su propio flujo y su propio consecutivo
// (#SO-000001, #RE-000001...). No se mezclan flujos entre tipos (ver internal-order-flow.ts).
//   SO  venta: un vendedor (o el quiosco) pide a bodega lo que el cliente quiere probar o comprar
//   RE  devolución física: lo que vuelve de la tienda a la bodega, siempre ligada a su SO
//   TR  traslado entre ubicaciones internas
//   RS  surtido: de bodega a tienda, para abastecer el punto de venta
// Las órdenes de compra (PO) tienen su propio módulo (purchase-order) y las pérdidas y bajas (LD)
// también (write-off): Pedidos solo las muestra.
export enum InternalOrderType {
  SO = 'SO',
  RE = 'RE',
  TR = 'TR',
  RS = 'RS',
}
