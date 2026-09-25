import { Decimal } from 'decimal.js';
import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import { CashSessionStatus } from '../entities/cash-session-status.enum.js';

registerEnumType(CashSessionStatus, {
  name: 'CashSessionStatus',
  description: 'Estado del turno de caja: abierto o cerrado',
});

@ObjectType('CashSession')
export class CashSessionObjectType extends BaseObjectType {
  @Field()
  cashRegisterId: string;

  // El administrador que abrió el turno
  @Field()
  openedBy: string;

  // El cajero que lo trabaja: el único que cobra y mueve dinero en él
  @Field()
  cashierId: string;

  @Field(() => String, { nullable: true })
  closedBy: string | null;

  @Field(() => Decimal)
  openingAmount: Decimal;

  // Al cerrar: lo que el sistema dice que debe haber en la caja
  @Field(() => Decimal, { nullable: true })
  expectedAmount: Decimal | null;

  // Al cerrar: lo que el cajero contó
  @Field(() => Decimal, { nullable: true })
  countedAmount: Decimal | null;

  // Al cerrar: contado − esperado (negativo si falta efectivo)
  @Field(() => Decimal, { nullable: true })
  differenceAmount: Decimal | null;

  @Field(() => CashSessionStatus)
  status: CashSessionStatus;

  @Field(() => Date)
  openedAt: Date;

  @Field(() => Date, { nullable: true })
  closedAt: Date | null;

  @Field(() => String, { nullable: true })
  notes: string | null;
}
