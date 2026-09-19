import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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

  // Rol con el que entra a la empresa de quien lo crea: el usuario nace ya como miembro de
  // ella, en el mismo paso, porque un usuario sin empresa no lo vería nadie.
  @Field(() => ID)
  @IsUUID()
  roleId: string;
}
