import { Transform } from 'class-transformer';

// Recorta los espacios de un texto ANTES de validarlo: así "   " cuenta como vacío y un @IsNotEmpty()
// lo rechaza (sin esto pasaba la validación y el servicio lo guardaba como NULL). Va en los campos de
// texto obligatorios o con longitud mínima; no toca lo que no es texto.
export const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
