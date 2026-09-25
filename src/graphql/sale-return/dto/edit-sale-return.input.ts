import { Field, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SaleReturnResolution } from '../entities/sale-return-resolution.enum.js';
import { SaleReturnItemInput } from './sale-return-item.input.js';

// Lo que un administrador cambia de una devolución todavía pendiente: qué líneas y cuántas unidades
// se devuelven (por ejemplo, solo 1 de los 2 productos que pidió el cajero), y si el cliente se lleva
// dinero o un cambio. Las líneas que llegan REEMPLAZAN a las anteriores; lo que valen lo calcula el
// servidor, igual que al pedirla.
@InputType()
export class EditSaleReturnInput {
  // Si no se manda, se queda la que tenía.
  @Field(() => SaleReturnResolution, { nullable: true })
  @IsOptional()
  @IsIn([SaleReturnResolution.REFUND, SaleReturnResolution.EXCHANGE])
  resolution?: SaleReturnResolution;

  @Field(() => [SaleReturnItemInput])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SaleReturnItemInput)
  items: SaleReturnItemInput[];

  // Si no se manda, se queda el motivo que tenía; un texto vacío lo borra.
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
