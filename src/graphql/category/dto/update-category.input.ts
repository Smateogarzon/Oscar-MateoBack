import { Field, ID, InputType } from '@nestjs/graphql';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';

@InputType()
export class UpdateCategoryInput {
  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  // `null` la vuelve categoría raíz (le quita el padre); ausente = no tocar el padre.
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  // `null` borra la descripción.
  @Field(() => String, { nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  description?: string | null;

  // Esta mercancía vive en la tienda y no pasa por corredor (ver `Category.directSale`): se vende
  // directo en caja y no se puede pedir a bodega. Se hereda a las subcategorías.
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  directSale?: boolean;
}
