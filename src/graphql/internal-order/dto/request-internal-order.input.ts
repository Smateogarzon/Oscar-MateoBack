import { Type } from 'class-transformer';
import { Field, ID, InputType } from '@nestjs/graphql';
import { ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { InternalOrderOrigin } from '../entities/internal-order-origin.enum.js';
import { InternalOrderType } from '../entities/internal-order-type.enum.js';
import { InternalOrderItemInput } from './internal-order-item.input.js';

@InputType()
export class RequestInternalOrderInput {
  @Field(() => InternalOrderType)
  @IsEnum(InternalOrderType)
  type: InternalOrderType;

  @Field(() => InternalOrderOrigin)
  @IsEnum(InternalOrderOrigin)
  origin: InternalOrderOrigin;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  sourceLocationId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  destinationLocationId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @Field(() => [InternalOrderItemInput])
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InternalOrderItemInput)
  items: InternalOrderItemInput[];
}
