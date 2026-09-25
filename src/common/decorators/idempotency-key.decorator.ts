import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { getRequestFromContext } from '../utils/request-from-context.util.js';

// Cabecera con la clave de idempotencia de la acción (ver graphql/idempotency/idempotency.ts). El
// front genera una clave por acción del usuario y la repite tal cual si reintenta esa misma acción.
export const IDEMPOTENCY_KEY_HEADER = 'x-idempotency-key';

// Un UUID o cualquier texto corto sin espacios: lo justo para que la clave sea una clave y no un
// vehículo de basura hacia la base de datos.
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,100}$/;

// La clave de esta petición, o undefined si no trae. Una clave mal formada se rechaza.
export const IdempotencyKeyHeader = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const raw = getRequestFromContext(context).headers?.[IDEMPOTENCY_KEY_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined || value === '') return undefined;
    if (!KEY_PATTERN.test(value)) {
      throw new BadRequestException('La clave de idempotencia no es válida');
    }
    return value;
  },
);
