import { Field, ID, InputType } from '@nestjs/graphql';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';

@InputType()
export class CreateCategoryInput {
  @Field()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  // Sin ella, la categoría nace raíz (sin padre).
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  description?: string;

  // Esta mercancía vive en la tienda y no pasa por corredor (ver `Category.directSale`): se vende
  // directo en caja y no se puede pedir a bodega. Se hereda a las subcategorías.
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  directSale?: boolean;
}
