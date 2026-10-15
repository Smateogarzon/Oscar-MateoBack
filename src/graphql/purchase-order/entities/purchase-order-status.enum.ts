// El recorrido de una orden de compra, confirmado con el usuario (2026-10-03):
//   DRAFT             el administrador la arma como un carrito, todavía no la ve nadie más
//   SENT              se la manda al proveedor (sendPurchaseOrder)
//   PENDING_APPROVAL  el proveedor despachó MÁS de lo que se le pidió en alguna referencia: el
//                     sobrante no pasa derecho, lo autoriza el administrador línea por línea
//                     (resolvePurchaseOrderOverage) antes de que bodega lo vea siquiera
//   SHIPPED           despachada y en camino a la bodega: el proveedor la revisó, CONTÓ lo que
//                     manda de cada referencia y la puso en camino (shipPurchaseOrder). Si mandó
//                     menos de lo pedido nace una novedad, pero eso no la detiene
//   RECEIVED          el bodeguero CONTÓ lo que llegó y la aceptó (receivePurchaseOrder): entra al
//                     inventario lo que él contó —ni lo pedido ni lo que dice el proveedor— y, si
//                     no cuadra con lo despachado, nace otra novedad
// CANCELLED puede pasar en cualquier punto antes de RECEIVED.
//
// No hay PARTIALLY_RECEIVED ni un paso de "el proveedor confirma": el proveedor despacha una vez
// (lo que falte es una novedad, no una entrega pendiente) y revisar la orden es parte de
// despacharla. Si el administrador rechaza el sobrante de una sola línea, el despacho entero se
// deshace y la orden vuelve a SENT: el proveedor la cuenta y la despacha otra vez.
export enum PurchaseOrderStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  SHIPPED = 'SHIPPED',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}
