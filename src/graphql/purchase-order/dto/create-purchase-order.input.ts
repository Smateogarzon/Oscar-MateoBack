import { Type } from 'class-transformer';
import { Field, ID, InputType } from '@nestjs/graphql';
import { IsDate, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { MONEY_PATTERN } from '../../../common/utils/money.js';

// Sin tabla de líneas todavía (ver purchase-order.entity.ts): subtotal y total se escriben a
// mano, no se calculan. Los montos viajan como texto y se convierten a Decimal en el servicio.
@InputType()
export class CreatePurchaseOrderInput {
  @Field(() => ID)
  @IsUUID()
  supplierId: string;

  @Field(() => ID)
  @IsUUID()
  destinationLocationId: string;

  @Field({ nullable: true })
  @IsOptional()
  @Matches(MONEY_PATTERN, {
    message: 'subtotal debe ser un monto de hasta 12 dígitos enteros y hasta 2 decimales, por ejemplo 150000',
  })
  subtotal?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Matches(MONEY_PATTERN, {
    message: 'total debe ser un monto de hasta 12 dígitos enteros y hasta 2 decimales, por ejemplo 178500',
  })
  total?: string;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedAt?: Date;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
