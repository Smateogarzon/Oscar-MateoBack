import { Decimal } from 'decimal.js';
import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import { BaseObjectType } from '../../../common/dto/base.object-type.js';
import { SaleReturnResolution } from '../entities/sale-return-resolution.enum.js';
import { SaleReturnStatus } from '../entities/sale-return-status.enum.js';

registerEnumType(SaleReturnResolution, {
  name: 'SaleReturnResolution',
  description: 'Cómo se resuelve la devolución: dinero, cambio o cambio con devolución de la diferencia',
});

registerEnumType(SaleReturnStatus, {
  name: 'SaleReturnStatus',
  description: 'Estado de la devolución: pendiente, aprobada, completada, rechazada o cancelada',
});

@ObjectType('SaleReturn')
export class SaleReturnObjectType extends BaseObjectType {
  @Field()
  companyId: string;

  // La venta original que se devuelve
  @Field()
  saleId: string;

  // Consecutivo por empresa, ej: DEV-00018
  @Field()
  returnNumber: string;

  // El número de la venta original (VTA-000123), para no tener que pedir las ventas solo para
  // mostrarlo; lo resuelve SaleReturnResolver. Nulo si la venta no tiene número (una venta anterior al
  // cambio que numera al cobrar nunca lo es, pero el tipo lo admite).
  @Field(() => String, { nullable: true })
  saleNumber: string | null;

  @Field(() => SaleReturnResolution)
  resolution: SaleReturnResolution;

  // La venta nueva de un cambio, cuando ya se cobró
  @Field(() => String, { nullable: true })
  replacementSaleId: string | null;

  // Lo que vale lo devuelto: lo que el cliente realmente pagó por esas unidades
  @Field(() => Decimal)
  totalReturned: Decimal;

  // Lo que ya se devolvió en dinero
  @Field(() => Decimal)
  refundAmount: Decimal;

  @Field(() => SaleReturnStatus)
  status: SaleReturnStatus;

  @Field(() => String, { nullable: true })
  reason: string | null;

  // Quien la registró
  @Field()
  processedBy: string;

  // Quien la aprobó, rechazó o canceló
  @Field(() => String, { nullable: true })
  resolvedBy: string | null;

  @Field(() => Date, { nullable: true })
  resolvedAt: Date | null;

  @Field(() => String, { nullable: true })
  resolutionNotes: string | null;

  @Field(() => Date, { nullable: true })
  completedAt: Date | null;
}
