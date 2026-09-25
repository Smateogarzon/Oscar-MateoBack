import { Field, ID, InputType } from '@nestjs/graphql';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { NormalizeEmail } from '../../../common/decorators/normalize-email.decorator.js';
import { Trim } from '../../../common/decorators/trim.decorator.js';

@InputType()
export class CreateUserInput {
  @Field()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName: string;

  @Field()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastName: string;

  @Field()
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(150)
  email: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(30)
  phone?: string;

  // También es la contraseña inicial del usuario (debe cambiarla en su primer login)
  @Field()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  documentNumber: string;

  // La foto se sube antes por /uploads y aquí llega su dirección: tiene que ser una URL http(s), no
  // cualquier texto (una dirección de seguimiento o un `javascript:` no son una foto).
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'], require_tld: false })
  avatarUrl?: string;

  // Rol con el que entra a la empresa de quien lo crea: el usuario nace ya como miembro de
  // ella, en el mismo paso, porque un usuario sin empresa no lo vería nadie.
  @Field(() => ID)
  @IsUUID()
  roleId: string;
}
