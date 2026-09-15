import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import '../../../common/dto/record-status.enum-type.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { LocationType } from '../entities/location-type.enum.js';

registerEnumType(LocationType, {
  name: 'LocationType',
  description: 'Tipo de sede: tienda o bodega',
});

@ObjectType('Location')
export class LocationObjectType extends BaseObjectType {
  // Empresa dueña de esta sede
  @Field()
  companyId: string;

  @Field()
  name: string;

  @Field(() => LocationType)
  type: LocationType;

  @Field({ nullable: true })
  address: string | null;

  @Field({ nullable: true })
  city: string | null;

  @Field({ nullable: true })
  phone: string | null;

  @Field({ nullable: true })
  email: string | null;

  @Field(() => RecordStatus)
  status: RecordStatus;
}
