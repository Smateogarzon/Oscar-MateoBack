import { BadRequestException, ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

// Mensajes por código de violación de Postgres. `unique` es para un índice único repetido
// (ConflictException); `foreignKey` es para una referencia que no existe (BadRequestException).
// Cada servicio pasa solo los que le aplican: el código que no tiene mensaje se responde con el
// error original, igual que si no fuera uno de estos dos casos.
export interface PostgresWriteErrorMessages {
  unique?: string;
  foreignKey?: string;
}

// Traduce el error de una escritura a Postgres al error de dominio que corresponde, para que cada
// servicio lo lance con `throw mapPostgresWriteError(error, { ... })` desde su `catch`. Si no es un
// error de escritura (QueryFailedError) o su código no tiene mensaje asignado, se devuelve tal cual.
export function mapPostgresWriteError(
  error: unknown,
  messages: PostgresWriteErrorMessages,
): Error {
  if (!(error instanceof QueryFailedError)) return error as Error;
  const code = (error.driverError as { code?: string } | undefined)?.code;

  if (code === FOREIGN_KEY_VIOLATION && messages.foreignKey) {
    return new BadRequestException(messages.foreignKey);
  }
  if (code === UNIQUE_VIOLATION && messages.unique) {
    return new ConflictException(messages.unique);
  }
  return error as Error;
}
