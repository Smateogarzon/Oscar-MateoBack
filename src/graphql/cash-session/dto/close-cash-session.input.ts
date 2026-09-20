import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { MONEY_PATTERN } from '../../../common/utils/money.js';

// El monto viaja como texto y se convierte a Decimal en el servicio (ver AddSaleItemInput).
@InputType()
export class CloseCashSessionInput {
  @Field(() => ID)
  @IsUUID()
  cashSessionId: string;

  // El efectivo que el cajero contó en la caja, ej: "348500". El servidor calcula lo esperado y
  // la diferencia.
  @Field()
  @Matches(MONEY_PATTERN, {
    message: 'countedAmount debe ser un monto con hasta 2 decimales, por ejemplo 348500',
  })
  countedAmount: string;

  // Obligatorias si lo contado no coincide con lo esperado
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
