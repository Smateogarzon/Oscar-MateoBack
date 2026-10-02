import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { QUANTITY_PATTERN } from '../../../common/utils/money.js';

@InputType()
export class WriteOffItemInput {
  @Field(() => ID)
  @IsUUID()
  productVariantId: string;

  @Field()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity debe ser una cantidad con hasta 2 decimales, por ejemplo 2 o 1.5',
  })
  quantity: string;

  // Si esta baja viene de una novedad ya reportada (una avería, una pérdida), para no reportarla dos veces.
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  incidentId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
