import { Field, ID, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { SalePaymentInput } from './sale-payment.input.js';

// Completar una venta es cobrarla: todos los pagos van juntos, suman exactamente el total de la
// venta y se guardan con ella en una sola operación. Los pagos no se editan después.
@InputType()
export class CompleteSaleInput {
  // Venta (en borrador) que se cobra
  @Field(() => ID)
  @IsUUID()
  saleId: string;

  // Turno de caja (abierto, de la misma tienda de la venta) en el que se cobra
  @Field(() => ID)
  @IsUUID()
  cashSessionId: string;

  // Devolución aprobada, de tipo cambio, cuyo crédito paga esta venta: es la venta nueva del cambio.
  // El crédito cubre hasta lo que valió lo devuelto; los pagos suman solo lo que falte y pueden ir
  // vacíos si el crédito alcanza para todo.
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  saleReturnId?: string;

  // Sin `saleReturnId` hace falta al menos un pago (lo revisa el servicio, no este validador)
  @Field(() => [SalePaymentInput])
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SalePaymentInput)
  payments: SalePaymentInput[];
}
