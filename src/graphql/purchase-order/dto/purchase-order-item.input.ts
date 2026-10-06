import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { MONEY_PATTERN, QUANTITY_PATTERN } from '../../../common/utils/money.js';

@InputType()
export class PurchaseOrderItemInput {
  @Field(() => ID)
  @IsUUID()
  productVariantId: string;

  @Field()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity debe ser una cantidad con hasta 2 decimales, por ejemplo 12 o 1.5',
  })
  quantity: string;

  // Sin él se usa el costo vigente de la variante.
  @Field({ nullable: true })
  @IsOptional()
  @Matches(MONEY_PATTERN, {
    message: 'unitCost debe ser un monto de hasta 12 dígitos enteros y hasta 2 decimales, por ejemplo 85000',
  })
  unitCost?: string;
}
