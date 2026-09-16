import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { LocationType } from '../entities/location-type.enum.js';

@InputType()
export class UpdateLocationInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @Field(() => LocationType, { nullable: true })
  @IsOptional()
  @IsEnum(LocationType)
  type?: LocationType;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  email?: string;
}
