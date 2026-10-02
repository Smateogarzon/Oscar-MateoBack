// Un zapato es un par, pero las dos unidades pueden terminar en sedes distintas (por ejemplo, una
// práctica contra robos: un pie en vitrina de una tienda, el otro guardado en otra). PAIR es el
// caso normal (el par completo, junto); LEFT/RIGHT son las mitades sueltas, sin su pareja todavía.
// Vender el par completo exige tener PAIR en una sede, o LEFT y RIGHT juntos en la misma.
export enum InventorySide {
  PAIR = 'PAIR',
  LEFT = 'LEFT',
  RIGHT = 'RIGHT',
}
