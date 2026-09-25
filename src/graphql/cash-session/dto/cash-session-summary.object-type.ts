import { Decimal } from 'decimal.js';
import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

// Lo que ha pasado en un turno hasta ahora (o hasta que se cerró), calculado en el momento: sirve
// para mostrar cuánto debería haber en la caja antes de contarla.
@ObjectType('CashSessionSummary')
export class CashSessionSummaryObjectType {
  @Field(() => ID)
  cashSessionId: string;

  @Field(() => Decimal)
  openingAmount: Decimal;

  // Ventas completadas en el turno
  @Field(() => Int)
  salesCount: number;

  // Ventas en borrador del turno: las que se borran al cerrarlo (para avisarlo antes de cerrar)
  @Field(() => Int)
  draftSalesCount: number;

  // Lo cobrado en efectivo: entra a la caja
  @Field(() => Decimal)
  cashSales: Decimal;

  // Lo cobrado con tarjeta o transferencia: no pasa por la caja
  @Field(() => Decimal)
  cardSales: Decimal;

  @Field(() => Decimal)
  transferSales: Decimal;

  // Ingresos y egresos manuales de efectivo
  @Field(() => Decimal)
  cashIn: Decimal;

  @Field(() => Decimal)
  cashOut: Decimal;

  // Reembolsos de devoluciones entregados en efectivo desde este turno: salen del cajón
  @Field(() => Decimal)
  cashRefunds: Decimal;

  // apertura + ventas en efectivo + ingresos − egresos − reembolsos en efectivo
  @Field(() => Decimal)
  expectedCash: Decimal;
}
