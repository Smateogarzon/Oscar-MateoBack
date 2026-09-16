import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

@InputType()
export class ChangePasswordInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  // El tope de 72 no es estético: bcrypt ignora en silencio todo byte más allá de 72,
  // así que una contraseña más larga daría una falsa sensación de seguridad.
  @Field()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}
