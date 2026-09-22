import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// Solo el nombre. La tienda no se cambia (una caja es un objeto físico) y el código tampoco: lo asignó
// el servidor al crearla y es fijo. Mandar `code` se rechaza (whitelist con forbidNonWhitelisted).
@InputType()
export class UpdateCashRegisterInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}
