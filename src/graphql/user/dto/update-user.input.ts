import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, MaxLength } from 'class-validator';

@InputType()
export class UpdateUserInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
