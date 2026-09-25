import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { NotificationChannel } from '../entities/notification-channel.enum.js';
import { NotificationEntityType } from '../entities/notification-entity-type.enum.js';
import { NotificationType } from '../entities/notification-type.enum.js';

registerEnumType(NotificationChannel, {
  name: 'NotificationChannel',
  description: 'El tema de un aviso: descuentos o devoluciones',
});

registerEnumType(NotificationType, {
  name: 'NotificationType',
  description:
    'Qué pasó: una solicitud de descuento o de devolución, y cómo se resolvió',
});

registerEnumType(NotificationEntityType, {
  name: 'NotificationEntityType',
  description:
    'A qué apunta un aviso: una solicitud de descuento o una devolución',
});

@ObjectType('Notification')
export class NotificationObjectType {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  notificationId: string;

  @Field(() => NotificationChannel)
  channel: NotificationChannel;

  @Field(() => NotificationType)
  type: NotificationType;

  @Field()
  title: string;

  @Field(() => String, { nullable: true })
  message: string | null;

  @Field(() => NotificationEntityType, { nullable: true })
  entityType: NotificationEntityType | null;

  @Field(() => ID, { nullable: true })
  entityId: string | null;

  @Field(() => ID, { nullable: true })
  locationId: string | null;

  @Field(() => ID, { nullable: true })
  actorId: string | null;

  @Field(() => Date, { nullable: true })
  readAt: Date | null;

  @Field(() => Date)
  createdAt: Date;
}
