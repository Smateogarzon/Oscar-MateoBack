import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// Para rechazar o cancelar una solicitud: una nota opcional que queda en su historial.
@InputType()
export class DiscountRequestNotesInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
