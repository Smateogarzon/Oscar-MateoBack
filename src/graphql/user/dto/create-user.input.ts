import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

@InputType()
export class CreateUserInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastName: string;

  @Field()
  @IsEmail()
  @MaxLength(150)
  email: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  // También es la contraseña inicial del usuario (debe cambiarla en su primer login)
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  documentNumber: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
