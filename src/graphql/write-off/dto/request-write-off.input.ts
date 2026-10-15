import { Field, ID, InputType } from '@nestjs/graphql';
import { ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { WriteOffItemInput } from './write-off-item.input.js';

@InputType()
export class RequestWriteOffInput {
  @Field(() => ID)
  @IsUUID()
  locationId: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @Field(() => [WriteOffItemInput])
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WriteOffItemInput)
  items: WriteOffItemInput[];
}
