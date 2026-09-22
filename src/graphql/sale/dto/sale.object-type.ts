import { Decimal } from 'decimal.js';
import { Field, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import { SaleStatus } from '../entities/sale-status.enum.js';

registerEnumType(SaleStatus, {
  name: 'SaleStatus',
  description: 'Estado de la venta: borrador, completada o cancelada',
});

@ObjectType('Sale')
export class SaleObjectType extends BaseObjectType {
  @Field()
  companyId: string;

  @Field()
  storeId: string;

  @Field(() => String, { nullable: true })
  internalOrderId: string | null;

  // Consecutivo por empresa, ej: VTA-000001
  @Field()
  saleNumber: string;

  @Field(() => String, { nullable: true })
  sellerId: string | null;

  @Field()
  cashierId: string;

  @Field(() => String, { nullable: true })
  cashSessionId: string | null;

  @Field(() => Decimal)
  subtotal: Decimal;

  // Todos los descuentos: los de cada línea más el descuento general
  @Field(() => Decimal)
  discountTotal: Decimal;

  // Descuento aprobado que se aplica a la venta (cero si no hay solicitud aprobada)
  @Field(() => Decimal)
  generalDiscount: Decimal;

  @Field(() => Decimal)
  total: Decimal;

  // Crédito de una devolución con el que se pagó (un cambio): pagos + crédito = total
  @Field(() => Decimal)
  returnCredit: Decimal;

  @Field(() => SaleStatus)
  status: SaleStatus;

  @Field(() => String, { nullable: true })
  cancelledBy: string | null;

  @Field(() => String, { nullable: true })
  cancellationReason: string | null;

  @Field(() => Date, { nullable: true })
  cancelledAt: Date | null;

  @Field(() => Date, { nullable: true })
  completedAt: Date | null;

  // Cuántas líneas tiene; lo resuelve SaleResolver (no viene de la entidad).
  @Field(() => Int)
  itemCount: number;
}
