import { Field, ID, InputType, ObjectType } from '@nestjs/graphql';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { InternalOrderItemVariantObjectType } from './internal-order-item-variant.object-type.js';

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

  // La bodega que despachó esto y a la que vuelve. Null si no salió de ninguna (la tienda lo vendía
  // directo): eso no se puede mandar a bodega y se queda en el cajón.
  @Field(() => ID, { nullable: true })
  originWarehouseId: string | null;

  @Field(() => String, { nullable: true })
  originWarehouseName: string | null;

  @Field(() => String, { nullable: true })
  addedByName: string | null;

  @Field(() => Date)
  createdAt: Date;
}

// Mandar a bodega lo del cajón de una tienda: qué referencias. A qué bodega va cada una no se manda:
// lo decide el servidor con el documento que la dejó en el cajón (ver `InternalOrderService
// .createReturnFromBin`), y va TODO lo que el cajón tenga de esas referencias.
@InputType()
export class CreateReturnFromBinInput {
  @Field(() => ID)
  @IsUUID()
  storeId: string;

  @Field(() => [ID])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  productVariantIds: string[];
}
