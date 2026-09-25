import { BadRequestException } from '@nestjs/common';
import { IDEMPOTENCY_KEY_HEADER, IdempotencyKeyHeader } from './idempotency-key.decorator.js';

// Un decorador de parámetro de Nest guarda su función en los metadatos del método donde se usa: se saca de ahí
// para probarla sin levantar la aplicación.
class Probe {
  handler() {}
}
IdempotencyKeyHeader()(Probe.prototype, 'handler', 0);
const [{ factory }] = Object.values(
  Reflect.getMetadata('__routeArguments__', Probe, 'handler') as Record<string, unknown>,
) as [{ factory: (data: unknown, context: unknown) => string | undefined }];

// Una petición REST cualquiera con estas cabeceras (Express las deja en minúsculas)
const requestWith = (headers: Record<string, unknown> | undefined) => ({
  getType: () => 'http',
  switchToHttp: () => ({ getRequest: () => ({ headers }) }),
});

const keyFrom = (value: unknown) =>
  factory(undefined, requestWith({ [IDEMPOTENCY_KEY_HEADER]: value }));

describe('IdempotencyKeyHeader', () => {
  it('reads the key from the x-idempotency-key header', () => {
    expect(IDEMPOTENCY_KEY_HEADER).toBe('x-idempotency-key');
    expect(keyFrom('3f2b9c1e-8a4d-4e6b-9f0a-1c2d3e4f5a6b')).toBe(
      '3f2b9c1e-8a4d-4e6b-9f0a-1c2d3e4f5a6b',
    );
  });

  it('answers undefined when the request carries no key: it is optional, so an old front does not break', () => {
    expect(factory(undefined, requestWith({}))).toBeUndefined();
    expect(factory(undefined, requestWith(undefined))).toBeUndefined();
  });

  it('answers undefined for an empty key', () => {
    expect(keyFrom('')).toBeUndefined();
  });

  it('takes the first one when the header comes repeated', () => {
    expect(keyFrom(['first-key-123', 'second-key-456'])).toBe('first-key-123');
  });

  it('accepts letters, digits and the characters _ . : -', () => {
    expect(keyFrom('Abc_123.def:456-XYZ')).toBe('Abc_123.def:456-XYZ');
  });

  it('accepts a key of 8 characters and one of 100', () => {
    expect(keyFrom('abcd1234')).toBe('abcd1234');
    expect(keyFrom('a'.repeat(100))).toHaveLength(100);
  });

  it('rejects a key that is too short or too long', () => {
    expect(() => keyFrom('abcd123')).toThrow(BadRequestException);
    expect(() => keyFrom('a'.repeat(101))).toThrow(BadRequestException);
  });

  it.each(['clave con espacios', 'clave;drop-table', "clave'--12345", 'a/b/c/d/e/f/g', 'clave-ñandú-1'])(
    'rejects a key with characters that do not belong in one (%s)',
    (key) => {
      expect(() => keyFrom(key)).toThrow(BadRequestException);
    },
  );

  it('rejects a repeated header whose first key is malformed', () => {
    expect(() => keyFrom(['no valida!', 'second-key-456'])).toThrow(BadRequestException);
  });

  it('explains what is wrong with the key', () => {
    expect(() => keyFrom('mal formada')).toThrow('La clave de idempotencia no es válida');
  });
});
