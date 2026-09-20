import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaymentMethodType } from '../entities/payment-method-type.enum.js';

@InputType()
export class CreatePaymentMethodInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  // No se puede cambiar después: define cómo se cuenta el dinero al cerrar el turno
  @Field(() => PaymentMethodType)
  @IsEnum(PaymentMethodType)
  type: PaymentMethodType;

  // Si es true, cobrar con este medio exige una referencia. Por defecto no la exige.
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  requiresReference?: boolean;
}
