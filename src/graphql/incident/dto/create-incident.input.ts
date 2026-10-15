import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { IncidentType } from '../entities/incident-type.enum.js';

@InputType()
export class CreateIncidentInput {
  @Field(() => IncidentType)
  @IsEnum(IncidentType)
  type: IncidentType;

  @Field()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  description?: string;

  // A qué se refiere (por ejemplo "SALE" + el id de la venta); libre, igual que en notifications.
  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  entityType?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  productVariantId?: string;
}
