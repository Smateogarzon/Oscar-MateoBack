import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';

@InputType()
export class CreateColorInput {
  @Field()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @Field({ nullable: true })
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'hex debe ser un color en formato #RRGGBB' })
  hex?: string;

  // El segundo tono de un color combinado ("Blanco negro"), p.ej. "#000000" junto a hex "#FFFFFF".
  @Field({ nullable: true })
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'secondHex debe ser un color en formato #RRGGBB' })
  secondHex?: string;
}
