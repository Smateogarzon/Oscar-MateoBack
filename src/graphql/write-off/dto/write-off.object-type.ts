import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { WriteOffStatus } from '../entities/write-off-status.enum.js';

registerEnumType(WriteOffStatus, { name: 'WriteOffStatus', description: 'Estado de una baja de inventario' });

// No extiende BaseObjectType: no tiene updatedAt (ver la entidad).
@ObjectType('WriteOff')
export class WriteOffObjectType {
  @Field(() => ID)
  id: string;

  @Field()
  companyId: string;

  @Field()
  locationId: string;

  @Field()
  writeOffNumber: string;

  @Field(() => WriteOffStatus)
  status: WriteOffStatus;

  @Field(() => String, { nullable: true })
  reason: string | null;

  @Field(() => String, { nullable: true })
  notes: string | null;

  @Field()
  requestedBy: string;

  @Field(() => ID, { nullable: true })
  resolvedBy: string | null;

  @Field(() => Date)
  requestedAt: Date;

  @Field(() => Date, { nullable: true })
  resolvedAt: Date | null;
}
