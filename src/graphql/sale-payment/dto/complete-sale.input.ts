import { Field, ID, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';
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

  @Field(() => [SalePaymentInput])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SalePaymentInput)
  payments: SalePaymentInput[];
}
