import { Type } from 'class-transformer';
import { Field, ID, InputType } from '@nestjs/graphql';
import { IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { InternalOrderStatus } from '../entities/internal-order-status.enum.js';
import { InternalOrderLineCountInput } from './internal-order-line-count.input.js';
import { InternalOrderLinePositionInput } from './internal-order-line-position.input.js';

// Pasar una orden a otro estado de su flujo (ver internal-order-flow.ts).
@InputType()
export class TransitionInternalOrderInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => InternalOrderStatus)
  @IsEnum(InternalOrderStatus)
  to: InternalOrderStatus;

  // Al dejarla lista (lo encontrado) o al verificar una devolución en bodega (lo contado). Sin dato,
  // cada línea vale lo pedido.
  @Field(() => [InternalOrderLineCountInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InternalOrderLineCountInput)
  lines?: InternalOrderLineCountInput[];

  // Al confirmar que llegó: dónde guardó quien recibe cada referencia. Opcional y por línea; lo que no
  // venga deja la posición que esa referencia ya tuviera en esa sede.
  @Field(() => [InternalOrderLinePositionInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InternalOrderLinePositionInput)
  positions?: InternalOrderLinePositionInput[];

  // El motivo, al anular.
  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
