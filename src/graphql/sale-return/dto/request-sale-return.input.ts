import { Field, ID, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SaleReturnResolution } from '../entities/sale-return-resolution.enum.js';
import { SaleReturnItemInput } from './sale-return-item.input.js';

@InputType()
export class RequestSaleReturnInput {
  // La venta original (ya cobrada) de la que se devuelve
  @Field(() => ID)
  @IsUUID()
  saleId: string;

  // REFUND: se devuelve el dinero · EXCHANGE: el cliente se lleva otro producto. PARTIAL_REFUND no
  // se pide: un cambio por algo más barato pasa a serlo solo, al cobrar la venta nueva.
  @Field(() => SaleReturnResolution)
  @IsIn([SaleReturnResolution.REFUND, SaleReturnResolution.EXCHANGE])
  resolution: SaleReturnResolution;

  // Las líneas y las cantidades que se devuelven; lo que valen lo calcula el servidor
  @Field(() => [SaleReturnItemInput])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SaleReturnItemInput)
  items: SaleReturnItemInput[];

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
