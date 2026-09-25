import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { IdempotencyKey } from './entities/idempotency-key.entity.js';

// Idempotencia de las mutaciones: una acción del usuario se hace UNA vez aunque la petición llegue
// dos (doble clic, reintento tras perder la respuesta, el navegador que repite un POST).
//
// Cómo se usa: el cliente manda una clave por acción en la cabecera `x-idempotency-key` (ver
// IdempotencyKeyHeader) y el servicio envuelve el trabajo de su transacción en `runIdempotent`. La
// clave se reclama con un INSERT en la MISMA transacción que la operación, respaldado por un índice
// único: la operación y su clave se confirman juntas o no queda ninguna, y dos peticiones con la misma
// clave a la vez no se pisan (la segunda espera a la primera y después recibe lo que ella creó). Si la
// petición no trae clave, todo funciona como antes: es opcional, así un front viejo no se rompe.
//
// Un reintento devuelve el recurso tal como está AHORA (se vuelve a cargar por su id), no una copia de
// la respuesta original: nunca hay que guardar ni volver a armar respuestas de GraphQL.

export interface IdempotencyScope {
  companyId: string;
  userId: string;
  // Nombre de la operación: la misma clave en dos operaciones distintas no se confunde
  operation: string;
  // La clave que mandó el cliente; sin ella no hay idempotencia por clave y se hace el trabajo normal
  key: string | undefined;
  // Lo que pidió el cliente, para detectar la misma clave con otros datos
  input?: unknown;
  // Qué tipo de recurso devuelve la operación (informativo, para diagnóstico)
  resourceType?: string;
}

// Las claves se guardan una semana: de sobra para un reintento, y la tabla no crece sin fin.
export const IDEMPOTENCY_RETENTION_DAYS = 7;
// Probabilidad de aprovechar una operación para borrar las claves vencidas (no hay tarea programada).
const PURGE_PROBABILITY = 0.01;

// Ordena las llaves de los objetos para que la misma petición dé siempre la misma huella.
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    // Fechas y Decimal se serializan solos (toJSON): así "2026-01-01" y su Date dan la misma huella.
    const jsonable = value as { toJSON?: () => unknown };
    if (typeof jsonable.toJSON === 'function') return stable(jsonable.toJSON());
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([name, item]) => [name, stable(item)]));
  }
  return value;
}

export function fingerprintOf(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stable(input ?? null)))
    .digest('hex');
}

const mismatch = () =>
  new ConflictException(
    'Esta operación ya se envió antes con otros datos: revisa el historial antes de repetirla',
  );

// Si la operación con esta clave ya se hizo, devuelve el recurso que creó; si no, null. Sirve de
// entrada rápida al comienzo de la transacción, antes de comprobaciones que fallarían en un
// reintento (por ejemplo "solo se cobra una venta en borrador"). No reclama la clave.
export async function findIdempotentResource<T extends { id: string }>(
  manager: EntityManager,
  scope: IdempotencyScope,
  load: (id: string) => Promise<T>,
): Promise<T | null> {
  if (!scope.key) return null;

  const existing = await manager.getRepository(IdempotencyKey).findOneBy({
    companyId: scope.companyId,
    userId: scope.userId,
    operation: scope.operation,
    key: scope.key,
  });
  if (!existing) return null;
  if (existing.fingerprint !== fingerprintOf(scope.input)) throw mismatch();
  if (!existing.resourceId) return null;
  return load(existing.resourceId);
}

// Hace `work` una sola vez por clave. Corre dentro de la transacción de quien llama (`manager`):
//   - la clave se reclama primero; si otra petición ya la tenía, se devuelve lo que ella creó y `work`
//     no se ejecuta;
//   - si `work` falla, la transacción se deshace y la clave con ella: un error nunca "gasta" la clave,
//     así el reintento de una operación que no llegó a hacerse sí se hace.
export async function runIdempotent<T extends { id: string }>(
  manager: EntityManager,
  scope: IdempotencyScope,
  work: () => Promise<T>,
  load: (id: string) => Promise<T>,
): Promise<T> {
  if (!scope.key) return work();

  const fingerprint = fingerprintOf(scope.input);
  const claimed: { id: string }[] = await manager.query(
    `INSERT INTO "idempotency_keys" ("companyId", "userId", "operation", "key", "fingerprint")
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ("companyId", "userId", "operation", "key") DO NOTHING
     RETURNING "id"`,
    [scope.companyId, scope.userId, scope.operation, scope.key, fingerprint],
  );

  if (claimed.length === 0) {
    // Otra petición con la misma clave ya la tenía (y terminó: el INSERT espera a que se confirme).
    const existing = await manager.getRepository(IdempotencyKey).findOneBy({
      companyId: scope.companyId,
      userId: scope.userId,
      operation: scope.operation,
      key: scope.key,
    });
    if (!existing?.resourceId) {
      throw new ConflictException('Esta operación ya está en curso: espera un momento y revisa el resultado');
    }
    if (existing.fingerprint !== fingerprint) throw mismatch();
    return load(existing.resourceId);
  }

  const result = await work();
  await manager.query(
    `UPDATE "idempotency_keys" SET "resourceType" = $2, "resourceId" = $3 WHERE "id" = $1`,
    [claimed[0].id, scope.resourceType ?? null, result.id],
  );
  purgeExpiredSometimes(manager);
  return result;
}

// Borra las claves de más de una semana, de vez en cuando y sin esperar: va por otra conexión del pool
// (la transacción de quien llama no se entera) y si falla no pasa nada, la próxima vez lo intenta.
function purgeExpiredSometimes(manager: EntityManager): void {
  if (Math.random() >= PURGE_PROBABILITY) return;
  const connection = manager.connection as { query?: (sql: string) => Promise<unknown> } | undefined;
  void connection
    ?.query?.(
      `DELETE FROM "idempotency_keys" WHERE "id" IN (
         SELECT "id" FROM "idempotency_keys"
         WHERE "createdAt" < now() - interval '${IDEMPOTENCY_RETENTION_DAYS} days'
         LIMIT 500
       )`,
    )
    .catch(() => undefined);
}
