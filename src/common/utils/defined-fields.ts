// Los campos de un DTO de actualización que sí vinieron. Con `target` ES2023 las clases de los DTO
// declaran cada campo como propiedad propia con valor `undefined`, y `Object.assign(entidad, dto)`
// borraría en la entidad devuelta lo que la petición no mencionó (un campo no nulo del esquema
// GraphQL respondería error). `null` sí cuenta: es la forma de vaciar un campo.
export function definedFields<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
