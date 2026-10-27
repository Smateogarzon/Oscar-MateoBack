// Integration test against a REAL local Postgres (no mocked Repository).
//
// Comprueba los candados contables de ../migrations/common/V0.4_protect_ledger.ts: los triggers que
// impiden borrar o editar el histórico de la caja desde una consola de SQL. No hay forma de probar
// esto con la Repository mockeada —la garantía la da Postgres, por debajo del servicio—, así que
// este archivo va directo a las tablas con `pg`, igual que
// ../graphql/cash-session/cash-session.concurrency.integration.spec.ts.
//
// Prueba las dos caras:
//   - lo que tiene que fallar: borrar un movimiento, un pago, un turno, una venta cobrada…
//   - lo que tiene que seguir pasando: los borrados de borradores que hace la propia aplicación.
//
// Cómo correr solo este archivo:
//   npx vitest run src/common/ledger-guards.integration.spec.ts
//
// SAFETY: igual que el otro test de integración, solo corre contra el Postgres local
// (DB_HOST=localhost|127.0.0.1 y DB_PORT=5432, o ALLOW_DB_WRITES=1) y nunca contra producción.
// Además, todo pasa dentro de UNA transacción que SIEMPRE termina en ROLLBACK: este archivo no deja
// una sola fila en la base, ni siquiera si un candado fallara.
import 'dotenv/config';
import pg from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { Pool } = pg;

const RUN_TOKEN = `TEST-LEDGER-${Date.now().toString(36)}`;

const dbPort = process.env.DB_PORT || '5432';
const writesAllowed =
  (process.env.DB_HOST === 'localhost' || process.env.DB_HOST === '127.0.0.1') &&
  (dbPort === '5432' || process.env.ALLOW_DB_WRITES === '1');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(dbPort),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 2,
});

let dbAvailable = false;
if (writesAllowed) {
  try {
    await pool.query('SELECT 1');
    dbAvailable = true;
  } catch {
    await pool.end().catch(() => {});
  }
} else {
  if (process.env.DB_HOST) {
    console.warn(
      `[ledger guards] Skipped: DB_HOST=${process.env.DB_HOST} DB_PORT=${dbPort} is not the local Postgres.`,
    );
  }
  await pool.end().catch(() => {});
}

// Las tablas con candado y el nombre de su trigger de fila.
const GUARDED_TABLES = [
  'cash_movements',
  'sale_payments',
  'refund_payments',
  'cash_sessions',
  'sales',
  'sale_items',
  'discount_requests',
  'discount_request_items',
  'sale_returns',
  'sale_return_items',
  'document_sequences',
  'idempotency_keys',
];

// 23001 (restrict_violation): el código con el que los triggers rechazan la operación.
const BLOCKED = '23001';

describe.skipIf(!dbAvailable)('Candados contables (Postgres real)', () => {
  let client: PoolClient;
  let sessionId: string;
  let movementId: string;
  let cashierId: string;
  let draftSaleId: string;

  // Todo el archivo vive en una transacción que nunca se confirma.
  beforeAll(async () => {
    client = await pool.connect();
    await client.query('BEGIN');

    const company = await client.query(
      `INSERT INTO companies (name, "taxId") VALUES ($1, $2) RETURNING id`,
      [`${RUN_TOKEN} Company`, RUN_TOKEN],
    );
    const store = await client.query(
      `INSERT INTO locations (name, type, "companyId") VALUES ($1, 'STORE', $2) RETURNING id`,
      [`${RUN_TOKEN} Store`, company.rows[0].id],
    );
    const register = await client.query(
      `INSERT INTO cash_registers (name, code, "storeId") VALUES ($1, $2, $3) RETURNING id`,
      [`${RUN_TOKEN} Register`, RUN_TOKEN, store.rows[0].id],
    );
    const user = await client.query(
      `INSERT INTO users ("firstName", "lastName", email, "passwordHash")
       VALUES ('Test', 'Cashier', $1, 'x') RETURNING id`,
      [`${RUN_TOKEN}@example.invalid`],
    );
    cashierId = user.rows[0].id;

    const session = await client.query(
      `INSERT INTO cash_sessions ("cashRegisterId", "openedBy", "cashierId", "openingAmount", "movementCode")
       VALUES ($1, $2, $2, 100000, '123456') RETURNING id`,
      [register.rows[0].id, cashierId],
    );
    sessionId = session.rows[0].id;

    const movement = await client.query(
      `INSERT INTO cash_movements ("cashSessionId", type, reason, amount, description, "createdBy")
       VALUES ($1, 'CASH_OUT', 'EXPENSE', 50000, 'Almuerzo', $2) RETURNING id`,
      [sessionId, cashierId],
    );
    movementId = movement.rows[0].id;

    // Una venta en borrador con una línea, para probar que lo permitido sigue permitido.
    const draft = await client.query(
      `INSERT INTO sales ("companyId", "storeId", "cashierId", "cashSessionId")
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [company.rows[0].id, store.rows[0].id, cashierId, sessionId],
    );
    await client.query(
      `INSERT INTO sale_items ("saleId", type, description, quantity, "unitPrice", total)
       VALUES ($1, 'GENERIC', 'Par de tenis', 1, 200000, 200000)`,
      [draft.rows[0].id],
    );
    draftSaleId = draft.rows[0].id;
  });

  afterAll(async () => {
    // Nada de lo de arriba queda en la base.
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  });

  // Corre algo que TIENE que ser rechazado, sin dejar la transacción abortada para las demás
  // pruebas: cada intento va entre un SAVEPOINT y su ROLLBACK TO.
  const expectBlocked = async (sql: string, params: unknown[] = []) => {
    await client.query('SAVEPOINT intento');
    const error = await client.query(sql, params).then(
      () => null,
      (caught: { code?: string; message?: string }) => caught,
    );
    await client.query('ROLLBACK TO SAVEPOINT intento');
    expect(error, `Esta operación tenía que ser rechazada: ${sql}`).not.toBeNull();
    expect(error?.code).toBe(BLOCKED);
    return error;
  };

  describe('los triggers están puestos', () => {
    it('cada tabla contable tiene su trigger de fila y su trigger de TRUNCATE, los dos en modo ALWAYS', async () => {
      const { rows } = await client.query(
        `SELECT c.relname AS table_name, t.tgname, t.tgenabled
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND c.relname = ANY($1::text[])`,
        [GUARDED_TABLES],
      );

      for (const table of GUARDED_TABLES) {
        const ofTable = rows.filter((row: { table_name: string }) => row.table_name === table);
        const names = ofTable.map((row: { tgname: string }) => row.tgname);
        expect(names, `Falta el trigger de fila en ${table}`).toContain(`trg_${table}_ledger`);
        expect(names, `Falta el trigger de TRUNCATE en ${table}`).toContain(
          `trg_${table}_no_truncate`,
        );
        // 'A' = ENABLE ALWAYS: se disparan incluso con session_replication_role = 'replica'.
        for (const trigger of ofTable) {
          expect(trigger.tgenabled, `${trigger.tgname} no está en modo ALWAYS`).toBe('A');
        }
      }
    });
  });

  describe('lo que ya no se puede', () => {
    it('no borra ni edita un movimiento de caja', async () => {
      const error = await expectBlocked(`DELETE FROM cash_movements WHERE id = $1`, [movementId]);
      expect(error?.message).toContain('registro contable');
      await expectBlocked(`UPDATE cash_movements SET amount = 1 WHERE id = $1`, [movementId]);
    });

    it('no borra los movimientos de un turno entero (el "borrar el día")', async () => {
      await expectBlocked(`DELETE FROM cash_movements WHERE "cashSessionId" = $1`, [sessionId]);
    });

    it('no vacía la tabla con TRUNCATE', async () => {
      await expectBlocked(`TRUNCATE cash_movements`);
      await expectBlocked(`TRUNCATE cash_movements CASCADE`);
    });

    it('no borra un turno de caja', async () => {
      await expectBlocked(`DELETE FROM cash_sessions WHERE id = $1`, [sessionId]);
    });

    it('no edita el arqueo de un turno ya cerrado', async () => {
      await client.query('SAVEPOINT cerrado');
      await client.query(
        `UPDATE cash_sessions SET status = 'CLOSED', "closedAt" = now(), "expectedAmount" = 50000,
                                  "countedAmount" = 50000, "differenceAmount" = 0
          WHERE id = $1`,
        [sessionId],
      );
      await expectBlocked(`UPDATE cash_sessions SET "countedAmount" = 999999 WHERE id = $1`, [
        sessionId,
      ]);
      await client.query('ROLLBACK TO SAVEPOINT cerrado');
    });

    it('no borra una venta ya cobrada ni sus líneas', async () => {
      await client.query('SAVEPOINT cobrada');
      await client.query(
        `UPDATE sales SET status = 'COMPLETED', "saleNumber" = 'VTA-TEST', "completedAt" = now() WHERE id = $1`,
        [draftSaleId],
      );
      await expectBlocked(`DELETE FROM sale_items WHERE "saleId" = $1`, [draftSaleId]);
      await expectBlocked(`DELETE FROM sales WHERE id = $1`, [draftSaleId]);
      await expectBlocked(`UPDATE sales SET total = 1 WHERE id = $1`, [draftSaleId]);
      await client.query('ROLLBACK TO SAVEPOINT cobrada');
    });
  });

  describe('lo que la aplicación sigue haciendo', () => {
    it('borra las líneas y la venta de un borrador (quitar línea, descartar al cerrar el turno)', async () => {
      await client.query('SAVEPOINT borrador');
      await client.query(`DELETE FROM sale_items WHERE "saleId" = $1`, [draftSaleId]);
      await client.query(`DELETE FROM sales WHERE id = $1`, [draftSaleId]);
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM sales WHERE id = $1`, [
        draftSaleId,
      ]);
      expect(rows[0].n).toBe(0);
      await client.query('ROLLBACK TO SAVEPOINT borrador');
    });

    it('registra un movimiento nuevo que compensa al anterior', async () => {
      await client.query('SAVEPOINT ajuste');
      await client.query(
        `INSERT INTO cash_movements ("cashSessionId", type, reason, amount, description, "createdBy")
         VALUES ($1, 'CASH_IN', 'DEPOSIT', 50000, 'Reversa del gasto mal registrado', $2)`,
        [sessionId, cashierId],
      );
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM cash_movements WHERE "cashSessionId" = $1`,
        [sessionId],
      );
      expect(rows[0].n).toBe(2);
      await client.query('ROLLBACK TO SAVEPOINT ajuste');
    });

    it('purga una clave de idempotencia vencida, pero no una vigente', async () => {
      await client.query('SAVEPOINT claves');
      const vigente = await client.query(
        `INSERT INTO idempotency_keys ("companyId", "userId", operation, key, fingerprint)
         VALUES (gen_random_uuid(), $1, 'test', $2, 'x') RETURNING id`,
        [cashierId, `${RUN_TOKEN}-viva`],
      );
      const vencida = await client.query(
        `INSERT INTO idempotency_keys ("companyId", "userId", operation, key, fingerprint, "createdAt")
         VALUES (gen_random_uuid(), $1, 'test', $2, 'x', now() - interval '30 days') RETURNING id`,
        [cashierId, `${RUN_TOKEN}-vieja`],
      );

      await expectBlocked(`DELETE FROM idempotency_keys WHERE id = $1`, [vigente.rows[0].id]);
      await client.query(`DELETE FROM idempotency_keys WHERE id = $1`, [vencida.rows[0].id]);
      await client.query('ROLLBACK TO SAVEPOINT claves');
    });
  });

  describe('la llave explícita', () => {
    it('deja borrar cuando se pide permiso a propósito, y vuelve a bloquear al soltarlo', async () => {
      await client.query('SAVEPOINT llave');
      // Un segundo movimiento del turno: es el que tiene que seguir protegido al soltar la llave (un
      // DELETE que no encuentra filas no dispara un trigger de fila, así que sin él no se probaría nada).
      await client.query(
        `INSERT INTO cash_movements ("cashSessionId", type, reason, amount, description, "createdBy")
         SELECT "cashSessionId", type, reason, amount, description, "createdBy" FROM cash_movements WHERE id = $1`,
        [movementId],
      );
      await client.query(`SET LOCAL app.ledger_override = 'ON'`);
      await client.query(`DELETE FROM cash_movements WHERE id = $1`, [movementId]);
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM cash_movements WHERE id = $1`,
        [movementId],
      );
      expect(rows[0].n).toBe(0);

      await client.query(`SET LOCAL app.ledger_override = 'OFF'`);
      await expectBlocked(`DELETE FROM cash_movements WHERE "cashSessionId" = $1`, [sessionId]);
      await client.query('ROLLBACK TO SAVEPOINT llave');
    });
  });
});
