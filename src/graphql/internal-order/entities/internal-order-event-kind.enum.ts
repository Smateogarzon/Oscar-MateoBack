// Qué registra una fila de la bitácora de una orden.
//   STATUS      cambió de estado (fromStatus → toStatus)
//   VERSION     nació una versión nueva (cambio de pedido, devolución, unión de una sub-orden)
//   CORRECTION  un paso del retorno a bodega por error (no cambia el estado)
//   NUDGE       el vendedor apuró el pedido, consultó a bodega o llamó al corredor
//   NOTE        cualquier otra anotación (una orden derivada que se creó, una novedad)
export enum InternalOrderEventKind {
  STATUS = 'STATUS',
  VERSION = 'VERSION',
  CORRECTION = 'CORRECTION',
  NUDGE = 'NUDGE',
  NOTE = 'NOTE',
}
