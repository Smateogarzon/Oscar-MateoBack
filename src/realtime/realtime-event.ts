import type { NotificationChannel } from '../graphql/notification/entities/notification-channel.enum.js';
import type { NotificationEntityType } from '../graphql/notification/entities/notification-entity-type.enum.js';
import type { NotificationType } from '../graphql/notification/entities/notification-type.enum.js';

export enum RealtimeEventKind {
  // A la persona le llegó un aviso nuevo: hay una fila más en sus notificaciones
  NOTIFICATION_CREATED = 'NOTIFICATION_CREATED',
  // Algo que le interesa cambió sin que haya un aviso para ella (por ejemplo, otra persona resolvió la
  // solicitud que también veía en su lista de pendientes)
  ENTITY_CHANGED = 'ENTITY_CHANGED',
}

// Lo que viaja en vivo: solo una SEÑAL de que algo cambió, nunca los datos. Quien la recibe vuelve a
// pedir lo que necesite con las consultas normales, que ya validan sus permisos. No se guarda: lo que
// pase mientras alguien está desconectado se recupera consultando al reconectar.
export interface RealtimeEvent {
  // A quién le llega: cada persona escucha solo su propio tema (empresa + usuario)
  companyId: string;
  userId: string;
  kind: RealtimeEventKind;
  channel: NotificationChannel;
  type: NotificationType | null;
  entityType: NotificationEntityType | null;
  entityId: string | null;
  at: Date;
}
