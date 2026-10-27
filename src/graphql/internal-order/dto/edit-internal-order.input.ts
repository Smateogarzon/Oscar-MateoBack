import { Type } from 'class-transformer';
import { Field, ID, InputType } from '@nestjs/graphql';
import { IsArray, IsOptional, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { QUANTITY_PATTERN } from '../../../common/utils/money.js';

// Una referencia que se suma al pedido.
@InputType()
export class EditInternalOrderLineInput {
  @Field(() => ID)
  @IsUUID()
  productVariantId: string;

  @Field()
  @Matches(QUANTITY_PATTERN, { message: 'quantity debe ser una cantidad con hasta 2 decimales' })
  quantity: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @MaxLength(500)
  notes?: string;
}

// Editar un pedido en curso: quitar referencias, agregar otras, o las dos cosas a la vez. Al menos
// una de las dos listas tiene que traer algo (lo comprueba el servicio, que es quien sabe además si
// las líneas existen en la versión vigente).
@InputType()
export class EditInternalOrderInput {
  @Field(() => ID)
  @IsUUID()
  orderId: string;

  // Las líneas de la versión vigente que salen del pedido.
  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  removeItemIds?: string[];

  // Las referencias que entran.
  @Field(() => [EditInternalOrderLineInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditInternalOrderLineInput)
  addLines?: EditInternalOrderLineInput[];
}
