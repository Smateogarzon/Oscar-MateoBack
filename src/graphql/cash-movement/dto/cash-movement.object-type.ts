import { Decimal } from 'decimal.js';
import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import { ImmutableObjectType } from '../../../common/dto/immutable.object-type.js';
import { CashMovementReason } from '../entities/cash-movement-reason.enum.js';
import { CashMovementType } from '../entities/cash-movement-type.enum.js';

registerEnumType(CashMovementType, {
  name: 'CashMovementType',
  description: 'Sentido del movimiento de caja: entrada o salida de efectivo',
});

registerEnumType(CashMovementReason, {
  name: 'CashMovementReason',
  description: 'Motivo del movimiento de caja',
});

@ObjectType('CashMovement')
export class CashMovementObjectType extends ImmutableObjectType {
  @Field()
  cashSessionId: string;

  @Field(() => CashMovementType)
  type: CashMovementType;

  @Field(() => CashMovementReason)
  reason: CashMovementReason;

  // Siempre positivo: el sentido lo da `type`
  @Field(() => Decimal)
  amount: Decimal;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field(() => String, { nullable: true })
  referenceNumber: string | null;

  @Field()
  createdBy: string;
}
