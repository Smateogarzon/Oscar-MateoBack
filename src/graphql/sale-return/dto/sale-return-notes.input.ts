import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// Para aprobar, rechazar o cancelar una devolución: una nota opcional.
@InputType()
export class SaleReturnNotesInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
