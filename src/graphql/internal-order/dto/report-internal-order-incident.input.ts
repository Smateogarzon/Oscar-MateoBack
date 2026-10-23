import { Field, ID, InputType } from '@nestjs/graphql';
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { IncidentType } from '../../incident/entities/incident-type.enum.js';

// Una novedad sobre una orden en curso, o sobre una de sus líneas vigentes (faltante, daño, problema
// al recoger o al entregar). Qué tipos aplican lo decide InternalOrderService (ORDER_INCIDENT_TYPES).
@InputType()
export class ReportInternalOrderIncidentInput {
  @Field(() => ID)
  @IsUUID()
  orderId: string;

  // Las líneas afectadas. Vacío (o ausente) significa que la novedad es de toda la orden: así se
  // reportan los problemas al recoger o al entregar, que no son de un producto. Una orden de una
  // sola línea no pregunta cuál es: el servicio la da por afectada.
  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  itemIds?: string[];

  @Field(() => IncidentType)
  @IsEnum(IncidentType)
  type: IncidentType;

  @Field()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;
}
