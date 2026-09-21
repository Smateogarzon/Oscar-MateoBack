import { Field, ID, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MONEY_PATTERN } from '../../../common/utils/money.js';

// Un reembolso al cliente por un medio de pago. El monto viaja como texto y se convierte a Decimal
// en el servicio (ver AddSaleItemInput).
@InputType()
export class RefundPaymentInput {
  // Medio de pago (activo, de la empresa) con el que se devuelve esta parte
  @Field(() => ID)
  @IsUUID()
  paymentMethodId: string;

  // Lo que se devuelve con este medio, ej: "60000". Todos los reembolsos suman lo que hay que devolver.
  @Field()
  @Matches(MONEY_PATTERN, {
    message: 'amount debe ser un monto con hasta 2 decimales, por ejemplo 60000',
  })
  amount: string;

  // Voucher, número de transferencia... Obligatoria si el medio de pago la exige.
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

// Entregar el reembolso de una devolución aprobada (REFUND, o la diferencia de un cambio por algo
// más barato). Todos los reembolsos van juntos y suman exactamente lo que hay que devolver.
@InputType()
export class CompleteReturnRefundInput {
  @Field(() => ID)
  @IsUUID()
  saleReturnId: string;

  // Turno de caja (abierto, del cajero) del que sale el efectivo. Obligatorio si algún reembolso es
  // en efectivo; un reembolso por tarjeta o transferencia no toca el cajón.
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  cashSessionId?: string;

  @Field(() => [RefundPaymentInput])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RefundPaymentInput)
  payments: RefundPaymentInput[];
}
