import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

// El tipo (efectivo, tarjeta, transferencia) no se cambia: para otro tipo se crea otro medio de pago.
@InputType()
export class UpdatePaymentMethodInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  requiresReference?: boolean;
}
