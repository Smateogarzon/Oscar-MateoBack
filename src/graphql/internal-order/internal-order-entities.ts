// Con qué valores de `entityType` una novedad queda ligada a una orden interna o a una de sus
// líneas. Viven aquí, y no en el servicio, porque los necesitan tanto el servicio (que las abre)
// como los watchers (que liquidan su aviso cuando ya no queda ninguna abierta), y el servicio ya
// importa a los watchers: tenerlas en medio evitaría que se importaran en círculo.
export const ORDER_INCIDENT_ENTITY = 'INTERNAL_ORDER';
export const ORDER_ITEM_INCIDENT_ENTITY = 'INTERNAL_ORDER_ITEM';
