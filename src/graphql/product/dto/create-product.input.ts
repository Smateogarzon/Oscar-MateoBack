import { Field, ID, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';

@InputType()
export class CreateProductInput {
  @Field()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  name: string;

  // Código de estilo interno de la empresa ("la referencia"); único dentro de ella.
  @Field()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  reference: string;

  @Field(() => ID)
  @IsUUID()
  categoryId: string;

  // Sin ella, el producto queda sin marca (no todo producto tiene una).
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
