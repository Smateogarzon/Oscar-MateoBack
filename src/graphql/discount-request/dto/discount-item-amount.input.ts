import { Field, ID, InputType } from '@nestjs/graphql';
import { IsUUID, Matches } from 'class-validator';
import { MONEY_PATTERN } from '../../../common/utils/money.js';

// El monto de descuento de UNA línea. Sirve para pedirlo (lo que se pide descontar en esa línea)
// y para aprobarlo o editarlo (lo que se aprueba). El monto viaja como texto y se convierte a
// Decimal en el servicio. Para pasar de un porcentaje a un monto: valor de la línea × porcentaje
// / 100, redondeado a centavos "mitad hacia arriba" (el tope es el 30 % del valor de la línea).
@InputType()
export class DiscountItemAmountInput {
  @Field(() => ID)
  @IsUUID()
  saleItemId: string;

  // Monto de dinero a descontar en esa línea, ej: "9500"
  @Field()
  @Matches(MONEY_PATTERN, {
    message: 'amount debe ser un monto con hasta 2 decimales, por ejemplo 9500',
  })
  amount: string;
}
