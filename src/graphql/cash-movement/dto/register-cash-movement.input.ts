import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { MONEY_PATTERN } from '../../../common/utils/money.js';
import { SAFE_TEXT_MESSAGE, SAFE_TEXT_PATTERN } from '../../../common/utils/text.js';
import { CASH_CODE_PATTERN } from '../../cash-session/cash-code.js';
import { CashMovementReason } from '../entities/cash-movement-reason.enum.js';
import { CashMovementType } from '../entities/cash-movement-type.enum.js';

// El monto viaja como texto y se convierte a Decimal en el servicio (ver AddSaleItemInput).
@InputType()
export class RegisterCashMovementInput {
  // Turno (abierto) en el que se mueve el efectivo
  @Field(() => ID)
  @IsUUID()
  cashSessionId: string;

  // El código del día de ese turno: se crea al abrirlo, solo lo ve el administrador y el cajero se
  // lo pide
  @Field()
  @Matches(CASH_CODE_PATTERN, { message: 'code debe tener 6 dígitos' })
  code: string;

  @Field(() => CashMovementType)
  @IsEnum(CashMovementType)
  type: CashMovementType;

  @Field(() => CashMovementReason)
  @IsEnum(CashMovementReason)
  reason: CashMovementReason;

  // Siempre positivo, ej: "15000": el sentido lo da `type`
  @Field()
  @Matches(MONEY_PATTERN, {
    message: 'amount debe ser un monto con hasta 2 decimales, por ejemplo 15000',
  })
  amount: string;

  // Por qué se movió el efectivo: obligatorio, para que el arqueo se pueda explicar después. Un texto
  // solo con espacios no cuenta (se recorta antes de validar).
  @Field()
  @Trim()
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  @Matches(SAFE_TEXT_PATTERN, { message: SAFE_TEXT_MESSAGE })
  description: string;

  // Número de un comprobante externo (recibo, consignación...)
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(SAFE_TEXT_PATTERN, { message: SAFE_TEXT_MESSAGE })
  referenceNumber?: string;
}
