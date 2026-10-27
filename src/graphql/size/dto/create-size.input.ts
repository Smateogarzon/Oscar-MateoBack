import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';

@InputType()
export class CreateSizeInput {
  @Field()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  name: string;
}
