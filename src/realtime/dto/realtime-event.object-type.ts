import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { NotificationChannel } from '../../graphql/notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../../graphql/notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../../graphql/notification/entities/notification-type.enum.js';
import { RealtimeEventKind } from '../realtime-event.js';

registerEnumType(RealtimeEventKind, {
  name: 'RealtimeEventKind',
  description:
    'Qué pasó en vivo: llegó un aviso nuevo, o cambió algo que la persona también estaba viendo',
});

// Una señal en vivo, sin datos: quien la recibe vuelve a consultar lo que necesite. `channel` dice
// de qué tema es (descuentos, devoluciones); `entityType` + `entityId`, a qué apunta.
@ObjectType('RealtimeEvent')
export class RealtimeEventObjectType {
  @Field(() => RealtimeEventKind)
  kind: RealtimeEventKind;

  @Field(() => NotificationChannel)
  channel: NotificationChannel;

  // Solo en los avisos nuevos: qué pasó
  @Field(() => NotificationType, { nullable: true })
  type: NotificationType | null;

  @Field(() => NotificationEntityType, { nullable: true })
  entityType: NotificationEntityType | null;

  @Field(() => ID, { nullable: true })
  entityId: string | null;

  @Field(() => Date)
  at: Date;
}
