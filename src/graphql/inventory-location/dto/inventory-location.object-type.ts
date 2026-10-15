import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import '../../../common/dto/record-status.enum-type.js';
import { RecordStatus } from '../../../common/enums/record-status.enum.js';
import { InventoryLocationType } from '../entities/inventory-location-type.enum.js';

registerEnumType(InventoryLocationType, {
  name: 'InventoryLocationType',
  description: 'Dónde vive físicamente un lote de existencias',
});

@ObjectType('InventoryLocation')
export class InventoryLocationObjectType extends BaseObjectType {
  @Field()
  companyId: string;

  @Field(() => ID, { nullable: true })
  locationId: string | null;

  @Field(() => InventoryLocationType)
  type: InventoryLocationType;

  @Field(() => ID, { nullable: true })
  custodianUserId: string | null;

  @Field(() => RecordStatus)
  status: RecordStatus;
}
