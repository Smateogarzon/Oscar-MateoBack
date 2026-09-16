import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { LocationType } from '../entities/location-type.enum.js';

@InputType()
export class CreateLocationInput {
  @Field(() => ID)
  @IsUUID()
  companyId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @Field(() => LocationType)
  @IsEnum(LocationType)
  type: LocationType;

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
