// Integration test against a REAL local Postgres (no mocked Repository).
//
// `CashSessionService.open()` pre-checks "does this register/cashier already have an OPEN
// session?" before inserting, but that check-then-insert is only safe from a race because of
// two partial unique indexes on `cash_sessions` (see entities/cash-session.entity.ts and the
// migrations under ../../migrations/cash-session/):
//   - IDX_0f325bbdcf03f9a87aa1cbd2b0: unique ("cashRegisterId") WHERE status = 'OPEN'
//   - IDX_480db45e12c56ed789515b11b0: unique ("cashierId")      WHERE status = 'OPEN'
// `cash-session.service.spec.ts` mocks the TypeORM repository, so it never touches these
// indexes — the actual guarantee that stops two people opening the same till (or the same
// cashier opening two tills) at once is never verified there. This file verifies it directly:
// it fires two concurrent INSERTs at the real table over two separate DB connections and
// asserts exactly one succeeds and the other fails with a unique-violation (code 23505).
//
// Raw `pg` INSERTs (not `CashSessionService.open()`) are used deliberately: the service's own
// pre-checks (register active, cashier has location access, etc.) require bootstrapping the
// full Nest DI container, which buys nothing for what this test is proving — the constraint is
// enforced by Postgres itself, below the service. Going straight at the table with `pg` is a
// direct, legitimate test of that real guarantee without the bootstrapping cost.
//
// How to run just this file:
//   npx vitest run src/graphql/cash-session/cash-session.concurrency.integration.spec.ts
//
// Included in the default `npm test` (`vitest run`) sweep: it matches `**/*.spec.ts`, same
// pattern as every other unit spec in this repo (there is no separate "integration" include —
// only `**/*.e2e-spec.ts`, used for full Nest bootstrap e2e tests, is split out into
// vitest.config.e2e.ts). Reusing the existing pattern is the least surprising choice, and it's
// safe to do because the suite below probes the DB connection first and skips cleanly (not a
// failure) when Postgres isn't reachable — so `npm test` stays green for anyone without a local
// Postgres running.
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// Distinctive per-run token: every fixture row this file creates is named/tagged with it, so
// cleanup is unambiguous and it can never collide with real dev data. Kept short because it
// also has to fit inside companies."taxId" and cash_registers."code", both varchar(30) (the
// latter with a 2-char "-A"/"-B"/"-C" suffix on top).
const RUN_TOKEN = `TEST-CONC-${Date.now().toString(36)}`;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 5,
});

let dbAvailable = true;
try {
  await pool.query('SELECT 1');
} catch {
  dbAvailable = false;
  await pool.end().catch(() => {});
}

describe.skipIf(!dbAvailable)('CashSession OPEN partial unique indexes (real Postgres)', () => {
  let companyId: string;
  let storeId: string;
  let registerAId: string;
  let registerBId: string;
  let registerCId: string;
  let adminId: string;
  let cashierOneId: string;
  let cashierTwoId: string;
  let cashierThreeId: string;
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    const company = await pool.query(
      `INSERT INTO companies (name, "taxId") VALUES ($1, $2) RETURNING id`,
      [`${RUN_TOKEN} Company`, RUN_TOKEN],
    );
    companyId = company.rows[0].id;

    const location = await pool.query(
      `INSERT INTO locations (name, type, "companyId") VALUES ($1, 'STORE', $2) RETURNING id`,
      [`${RUN_TOKEN} Store`, companyId],
    );
    storeId = location.rows[0].id;

    const registers = await pool.query(
      `INSERT INTO cash_registers (name, code, "storeId")
       VALUES ($1, $2, $4), ($1, $3, $4)
       RETURNING id`,
      [`${RUN_TOKEN} Register`, `${RUN_TOKEN}-A`, `${RUN_TOKEN}-B`, storeId],
    );
    // Third register needs its own INSERT (the two-row form above only takes two codes).
    const registerC = await pool.query(
      `INSERT INTO cash_registers (name, code, "storeId") VALUES ($1, $2, $3) RETURNING id`,
      [`${RUN_TOKEN} Register`, `${RUN_TOKEN}-C`, storeId],
    );
    [registerAId, registerBId] = registers.rows.map((row: { id: string }) => row.id);
    registerCId = registerC.rows[0].id;

    const users = await pool.query(
      `INSERT INTO users ("firstName", "lastName", email, "passwordHash")
       VALUES
         ('Test', 'Admin', $1, 'x'),
         ('Test', 'Cashier1', $2, 'x'),
         ('Test', 'Cashier2', $3, 'x'),
         ('Test', 'Cashier3', $4, 'x')
       RETURNING id`,
      [
        `${RUN_TOKEN}-admin@example.invalid`,
        `${RUN_TOKEN}-cashier1@example.invalid`,
        `${RUN_TOKEN}-cashier2@example.invalid`,
        `${RUN_TOKEN}-cashier3@example.invalid`,
      ],
    );
    [adminId, cashierOneId, cashierTwoId, cashierThreeId] = users.rows.map(
      (row: { id: string }) => row.id,
    );
  });

  afterAll(async () => {
    try {
      // FK-safe order: cash_sessions -> cash_registers -> locations -> companies, then users
      // (users are only referenced by cash_sessions, already gone by this point).
      const registerIds = [registerAId, registerBId, registerCId].filter(Boolean);
      if (registerIds.length > 0) {
        await pool.query(`DELETE FROM cash_sessions WHERE "cashRegisterId" = ANY($1::uuid[])`, [
          registerIds,
        ]);
      }
      if (createdSessionIds.length > 0) {
        await pool.query(`DELETE FROM cash_sessions WHERE id = ANY($1::uuid[])`, [
          createdSessionIds,
        ]);
      }
      if (registerIds.length > 0) {
        await pool.query(`DELETE FROM cash_registers WHERE id = ANY($1::uuid[])`, [registerIds]);
      }
      if (storeId) await pool.query(`DELETE FROM locations WHERE id = $1`, [storeId]);
      if (companyId) await pool.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
      const userIds = [adminId, cashierOneId, cashierTwoId, cashierThreeId].filter(Boolean);
      if (userIds.length > 0) {
        await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
      }
    } finally {
      await pool.end();
    }
  });

  type InsertOutcome =
    | { ok: true; id: string }
    | { ok: false; code: string | undefined; message: string };

  // Opens a session with a plain INSERT (no service-level pre-checks, no transaction): exactly
  // what a second, unlucky concurrent request would do if it slipped past the service's own
  // existsBy() checks. Only the partial unique indexes stand in its way here.
  async function insertOpenSession(
    client: pg.PoolClient,
    args: { cashRegisterId: string; cashierId: string; movementCode: string },
  ): Promise<InsertOutcome> {
    try {
      const result = await client.query(
        `INSERT INTO cash_sessions ("cashRegisterId", "openedBy", "cashierId", "movementCode", status)
         VALUES ($1, $2, $3, $4, 'OPEN') RETURNING id`,
        [args.cashRegisterId, adminId, args.cashierId, args.movementCode],
      );
      const id = result.rows[0].id as string;
      createdSessionIds.push(id);
      return { ok: true, id };
    } catch (error) {
      const dbError = error as { code?: string; message: string };
      return { ok: false, code: dbError.code, message: dbError.message };
    }
  }

  it('rejects a second concurrent OPEN session for the same cash register', async () => {
    const [clientA, clientB] = await Promise.all([pool.connect(), pool.connect()]);
    try {
      const [resultA, resultB] = await Promise.all([
        insertOpenSession(clientA, {
          cashRegisterId: registerAId,
          cashierId: cashierOneId,
          movementCode: '111111',
        }),
        insertOpenSession(clientB, {
          cashRegisterId: registerAId,
          cashierId: cashierTwoId,
          movementCode: '222222',
        }),
      ]);

      const outcomes = [resultA, resultB];
      const succeeded = outcomes.filter((outcome) => outcome.ok);
      const failed = outcomes.filter((outcome): outcome is Extract<InsertOutcome, { ok: false }> =>
        !outcome.ok,
      );

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0].code).toBe('23505');
      expect(failed[0].message).toMatch(/IDX_0f325bbdcf03f9a87aa1cbd2b0/);
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  it('rejects a second concurrent OPEN session for the same cashier', async () => {
    const [clientA, clientB] = await Promise.all([pool.connect(), pool.connect()]);
    try {
      const [resultA, resultB] = await Promise.all([
        insertOpenSession(clientA, {
          cashRegisterId: registerBId,
          cashierId: cashierThreeId,
          movementCode: '333333',
        }),
        insertOpenSession(clientB, {
          cashRegisterId: registerCId,
          cashierId: cashierThreeId,
          movementCode: '444444',
        }),
      ]);

      const outcomes = [resultA, resultB];
      const succeeded = outcomes.filter((outcome) => outcome.ok);
      const failed = outcomes.filter((outcome): outcome is Extract<InsertOutcome, { ok: false }> =>
        !outcome.ok,
      );

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0].code).toBe('23505');
      expect(failed[0].message).toMatch(/IDX_480db45e12c56ed789515b11b0/);
    } finally {
      clientA.release();
      clientB.release();
    }
  });
});
