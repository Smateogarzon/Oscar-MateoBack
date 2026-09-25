import { ForbiddenException, type HttpException } from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'node:crypto';

// El código de un turno de caja ("código del día"): 6 dígitos que se crean al abrir el turno (uno
// nuevo en cada apertura), que solo ve el administrador y que valen hasta que el turno se cierra.
// El cajero se lo pide al administrador cada vez que registra un movimiento de caja
// (CashMovementService.register). Vender y cobrar no lo piden.
export const CASH_CODE_LENGTH = 6;
export const CASH_CODE_PATTERN = /^\d{6}$/;

// Códigos equivocados seguidos que bloquean los movimientos del turno hasta que el administrador
// genere otro código: sin este límite se podrían probar el millón de combinaciones en un día.
export const MAX_CASH_CODE_FAILURES = 5;

export enum CashCodeVerdict {
  OK = 'OK',
  WRONG = 'WRONG',
  LOCKED = 'LOCKED',
}

// Con ceros a la izquierda: 4821 -> "004821".
export function formatCashCode(value: number): string {
  return value.toString().padStart(CASH_CODE_LENGTH, '0');
}

// Seis dígitos al azar con el generador criptográfico de Node.
export function generateCashCode(): string {
  return formatCashCode(randomInt(0, 10 ** CASH_CODE_LENGTH));
}

// Compara en tiempo constante, para que quien lo intenta no deduzca por lo que tarda la respuesta
// cuántos dígitos acertó.
export function isCashCode(given: string, expected: string): boolean {
  const givenBytes = Buffer.from(given);
  const expectedBytes = Buffer.from(expected);
  return givenBytes.length === expectedBytes.length && timingSafeEqual(givenBytes, expectedBytes);
}

// El error que corresponde a un código rechazado. Quien verifica el código NO lo lanza dentro de su
// transacción: un intento equivocado se cuenta y se guarda, y si el error deshiciera la transacción
// el contador volvería atrás. Lo lanza después de confirmarla.
export function cashCodeException(
  verdict: Exclude<CashCodeVerdict, CashCodeVerdict.OK>,
): HttpException {
  return verdict === CashCodeVerdict.LOCKED
    ? new ForbiddenException(
        'Los movimientos de este turno están bloqueados por demasiados códigos equivocados: pide al administrador que genere otro código',
      )
    : new ForbiddenException('Código del día incorrecto');
}
