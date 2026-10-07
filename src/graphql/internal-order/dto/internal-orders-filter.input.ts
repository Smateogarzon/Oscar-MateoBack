import { Type } from 'class-transformer';
import { Field, ID, InputType } from '@nestjs/graphql';
import { IsBoolean, IsDate, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { InternalOrderStatus } from '../entities/internal-order-status.enum.js';
import { InternalOrderType } from '../entities/internal-order-type.enum.js';

@InputType()
export class InternalOrdersFilterInput {
  @Field(() => InternalOrderType, { nullable: true })
  @IsOptional()
  @IsEnum(InternalOrderType)
  type?: InternalOrderType;

  @Field(() => InternalOrderStatus, { nullable: true })
  @IsOptional()
  @IsEnum(InternalOrderStatus)
  status?: InternalOrderStatus;

  // true: solo las que siguen en curso; false: solo las cerradas (en un estado final).
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  open?: boolean;

  // Cerradas dentro de este rango (por la fecha de su último cambio de estado).
  @Field(() => Date, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  closedFrom?: Date;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  closedTo?: Date;

  // El tablero del día: todo lo abierto más lo cerrado desde esta fecha.
  @Field(() => Date, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  activeSince?: Date;

  // Las que van a una sede (la cola de cobro de una tienda).
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  destinationLocationId?: string;

  // Solo las que pidió quien consulta ("Mis pedidos"), aunque pueda ver todas.
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  mine?: boolean;
}
