import { InputType } from '@nestjs/graphql';
import { ApproveDiscountRequestInput } from './approve-discount-request.input.js';

// Lo mismo que se envía al aprobar, pero para cambiar los MONTOS de un descuento ya aprobado.
// No cambia a qué líneas apunta: eso solo se define al pedirlo.
@InputType()
export class EditApprovedDiscountInput extends ApproveDiscountRequestInput {}
