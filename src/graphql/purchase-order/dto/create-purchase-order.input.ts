import { Type } from 'class-transformer';
import { Field, ID, InputType } from '@nestjs/graphql';
import { ArrayMinSize, IsArray, IsDate, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { PurchaseOrderItemInput } from './purchase-order-item.input.js';

// El subtotal y el total no se escriben: salen de las líneas (ver purchase-order-totals.ts).
@InputType()
export class CreatePurchaseOrderInput {
  // Sin él, la orden va al único proveedor de la empresa (ver resolveSupplierId).
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @Field(() => ID)
  @IsUUID()
  destinationLocationId: string;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedAt?: Date;

  @Field(() => [PurchaseOrderItemInput])
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemInput)
  items: PurchaseOrderItemInput[];
}
