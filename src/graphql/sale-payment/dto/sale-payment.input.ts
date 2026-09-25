import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { MONEY_PATTERN } from '../../../common/utils/money.js';

// El monto viaja como texto y se convierte a Decimal en el servicio (ver AddSaleItemInput).
@InputType()
export class SalePaymentInput {
  // Medio de pago (activo, de la empresa) con el que se paga esta parte
  @Field(() => ID)
  @IsUUID()
  paymentMethodId: string;

  // Lo que se aplica a la venta con este medio, ej: "80000". Todos los pagos suman el total.
  @Field()
  @Matches(MONEY_PATTERN, {
    message: 'amount debe ser un monto con hasta 2 decimales, por ejemplo 80000',
  })
  amount: string;

  // Voucher, número de transferencia... Obligatoria si el medio de pago la exige.
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}
