import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { IncidentStatus } from '../entities/incident-status.enum.js';
import { IncidentType } from '../entities/incident-type.enum.js';

registerEnumType(IncidentType, { name: 'IncidentType', description: 'Qué clase de novedad es' });
registerEnumType(IncidentStatus, { name: 'IncidentStatus', description: 'Estado de la novedad' });

// No extiende BaseObjectType: la tabla no tiene updatedAt (ver la entidad).
@ObjectType('Incident')
export class IncidentObjectType {
  @Field(() => ID)
  id: string;

  @Field()
  companyId: string;

  @Field(() => IncidentType)
  type: IncidentType;

  @Field(() => IncidentStatus)
  status: IncidentStatus;

  @Field()
  title: string;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field(() => String, { nullable: true })
  entityType: string | null;

  @Field(() => ID, { nullable: true })
  entityId: string | null;

  @Field(() => ID, { nullable: true })
  locationId: string | null;

  @Field(() => ID, { nullable: true })
  productVariantId: string | null;

  @Field()
  reportedBy: string;

  @Field(() => ID, { nullable: true })
  resolvedBy: string | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date, { nullable: true })
  resolvedAt: Date | null;
}
