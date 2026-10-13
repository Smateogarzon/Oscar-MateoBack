import { Type } from 'class-transformer';
import { Field, ID, InputType, ObjectType } from '@nestjs/graphql';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';
import { InternalOrderItemVariantObjectType } from './internal-order-item-variant.object-type.js';
import { InternalOrderLineInput } from './request-internal-order.input.js';

// Lo que hay en el cajón de devoluciones de una tienda: cada entrada dice qué variante, cuánto, de qué
// documento llegó (el pedido, la venta o la devolución) y desde cuándo está ahí.
@ObjectType('ReturnsBinLine')
export class ReturnsBinLineObjectType {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  storeId: string;

  @Field()
  storeName: string;

  @Field(() => ID)
  productVariantId: string;

  @Field(() => InternalOrderItemVariantObjectType, { nullable: true })
  variant: InternalOrderItemVariantObjectType | null;

  @Field()
  quantity: string;

  @Field(() => String, { nullable: true })
  sourceNumber: string | null;

  @Field(() => String, { nullable: true })
  addedByName: string | null;

  @Field(() => Date)
  createdAt: Date;
}

// Mandar a bodega lo del cajón de una tienda: a qué bodega y cuánto de cada variante.
@InputType()
export class CreateReturnFromBinInput {
  @Field(() => ID)
  @IsUUID()
  storeId: string;

  @Field(() => ID)
  @IsUUID()
  warehouseId: string;

  @Field(() => [InternalOrderLineInput])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => InternalOrderLineInput)
  lines: InternalOrderLineInput[];
}
