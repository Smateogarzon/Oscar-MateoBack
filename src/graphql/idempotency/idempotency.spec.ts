import { ConflictException } from '@nestjs/common';
import { IdempotencyKey } from './entities/idempotency-key.entity.js';
import {
  IDEMPOTENCY_RETENTION_DAYS,
  findIdempotentResource,
  fingerprintOf,
  runIdempotent,
  type IdempotencyScope,
} from './idempotency.js';

const COMPANY = 'company-1';
const USER = 'user-1';

const scope = (overrides: Partial<IdempotencyScope> = {}): IdempotencyScope => ({
  companyId: COMPANY,
  userId: USER,
  operation: 'createThing',
  key: 'key-12345678',
  input: { name: 'Ana', amount: 10 },
  resourceType: 'thing',
  ...overrides,
});

// La fila de la clave tal como la guarda la base
const storedKey = (overrides: Record<string, unknown> = {}) => ({
  resourceId: 'thing-9',
  fingerprint: fingerprintOf(scope().input),
  ...overrides,
});

function createManager() {
  const keyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  // Por defecto la clave se reclama: el INSERT devuelve la fila nueva
  const query = vi.fn().mockResolvedValue([{ id: 'claim-1' }]);
  // La conexión del pool, por donde va el borrado de claves vencidas (fuera de la transacción)
  const connection = { query: vi.fn().mockResolvedValue(undefined) };
  const manager = {
    query,
    connection,
    getRepository: vi.fn((entity: unknown) => (entity === IdempotencyKey ? keyRepo : undefined)),
  };
  return { manager: manager as never, query, keyRepo, connection };
}

// El trabajo de la operación y la recarga de lo que ya se creó
function createWork() {
  return {
    work: vi.fn(async () => ({ id: 'thing-1' })),
    load: vi.fn(async (id: string) => ({ id, loaded: true })),
  };
}

// Una tabla de claves en memoria, con el mismo comportamiento que el índice único: reclamar una clave que ya
// existe no devuelve fila, y las claves de otro usuario, empresa u operación son otras claves.
function createInMemoryManager() {
  const rows = new Map<
    string,
    { id: string; fingerprint: string; resourceId: string | null }
  >();
  const keyOf = (companyId: unknown, userId: unknown, operation: unknown, key: unknown) =>
    [companyId, userId, operation, key].join('|');

  const query = vi.fn(async (sql: string, params: string[]) => {
    if (sql.includes('INSERT INTO "idempotency_keys"')) {
      const key = keyOf(params[0], params[1], params[2], params[3]);
      if (rows.has(key)) return [];
      const row = { id: `claim-${rows.size + 1}`, fingerprint: params[4], resourceId: null };
      rows.set(key, row);
      return [{ id: row.id }];
    }
    if (sql.includes('UPDATE "idempotency_keys"')) {
      const row = [...rows.values()].find((candidate) => candidate.id === params[0]);
      if (row) row.resourceId = params[2];
    }
    return [];
  });
  const keyRepo = {
    findOneBy: vi.fn(
      async (where: Record<string, string>) =>
        rows.get(keyOf(where.companyId, where.userId, where.operation, where.key)) ?? null,
    ),
  };
  const manager = {
    query,
    connection: undefined,
    getRepository: (entity: unknown) => (entity === IdempotencyKey ? keyRepo : undefined),
  };
  return { manager: manager as never };
}

describe('idempotency', () => {
  beforeEach(() => {
    // El borrado de claves vencidas es aleatorio (1%): por defecto, no toca
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fingerprintOf', () => {
    it('gives a sha256 in hex', () => {
      expect(fingerprintOf({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is the same for the same request, however the keys are ordered', () => {
      expect(fingerprintOf({ a: 1, b: { c: 2, d: 3 } })).toBe(
        fingerprintOf({ b: { d: 3, c: 2 }, a: 1 }),
      );
    });

    it('sorts the keys of objects inside arrays too, but keeps the order of the arrays', () => {
      expect(fingerprintOf([{ a: 1, b: 2 }])).toBe(fingerprintOf([{ b: 2, a: 1 }]));
      expect(fingerprintOf([1, 2])).not.toBe(fingerprintOf([2, 1]));
    });

    it('ignores fields that are undefined', () => {
      expect(fingerprintOf({ a: 1, b: undefined })).toBe(fingerprintOf({ a: 1 }));
    });

    it('is different when any value is different', () => {
      expect(fingerprintOf({ amount: 10 })).not.toBe(fingerprintOf({ amount: 11 }));
      expect(fingerprintOf({ amount: 10 })).not.toBe(fingerprintOf({ amount: '10' }));
      expect(fingerprintOf({ a: null })).not.toBe(fingerprintOf({}));
    });

    it('gives a date the same fingerprint as its ISO text', () => {
      expect(fingerprintOf({ at: new Date('2026-01-01T00:00:00.000Z') })).toBe(
        fingerprintOf({ at: '2026-01-01T00:00:00.000Z' }),
      );
    });

    it('serializes what knows how to serialize itself (like Decimal) by its own value', () => {
      const amount = { toJSON: () => '12.50' };

      expect(fingerprintOf({ amount })).toBe(fingerprintOf({ amount: '12.50' }));
    });

    it('treats a missing input like a null one', () => {
      expect(fingerprintOf(undefined)).toBe(fingerprintOf(null));
    });
  });

  describe('runIdempotent', () => {
    it('just does the work when the request carries no key', async () => {
      const { manager, query, keyRepo } = createManager();
      const { work, load } = createWork();

      const result = await runIdempotent(manager, scope({ key: undefined }), work, load);

      expect(result).toEqual({ id: 'thing-1' });
      expect(work).toHaveBeenCalledTimes(1);
      expect(query).not.toHaveBeenCalled();
      expect(keyRepo.findOneBy).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    });

    it('treats an empty key as no key', async () => {
      const { manager, query } = createManager();
      const { work, load } = createWork();

      await runIdempotent(manager, scope({ key: '' }), work, load);

      expect(work).toHaveBeenCalledTimes(1);
      expect(query).not.toHaveBeenCalled();
    });

    it('claims the key before doing the work and links it to what the work created', async () => {
      const { manager, query } = createManager();
      const { work, load } = createWork();

      const result = await runIdempotent(manager, scope(), work, load);

      expect(result).toEqual({ id: 'thing-1' });
      expect(query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO "idempotency_keys"'),
        [COMPANY, USER, 'createThing', 'key-12345678', fingerprintOf({ name: 'Ana', amount: 10 })],
      );
      expect(query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE "idempotency_keys"'),
        ['claim-1', 'thing', 'thing-1'],
      );
      // Reclamar va antes del trabajo, y vincular el recurso, después
      expect(query.mock.invocationCallOrder[0]).toBeLessThan(work.mock.invocationCallOrder[0]);
      expect(query.mock.invocationCallOrder[1]).toBeGreaterThan(work.mock.invocationCallOrder[0]);
      expect(load).not.toHaveBeenCalled();
    });

    it('claims with INSERT ... ON CONFLICT DO NOTHING, through the manager of the caller’s transaction', async () => {
      const { manager, query, connection } = createManager();
      const { work, load } = createWork();

      await runIdempotent(manager, scope(), work, load);

      expect(query.mock.calls[0][0]).toContain(
        'ON CONFLICT ("companyId", "userId", "operation", "key") DO NOTHING',
      );
      expect(query.mock.calls[0][0]).toContain('RETURNING "id"');
      // Nada va por otra conexión (esa es la del borrado de claves vencidas)
      expect(connection.query).not.toHaveBeenCalled();
    });

    it('records no resource type when the scope has none', async () => {
      const { manager, query } = createManager();
      const { work, load } = createWork();

      await runIdempotent(manager, scope({ resourceType: undefined }), work, load);

      expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE'), [
        'claim-1',
        null,
        'thing-1',
      ]);
    });

    it('answers a retry with what the first request created, without doing the work again', async () => {
      const { manager, query, keyRepo } = createManager();
      const { work, load } = createWork();
      query.mockResolvedValueOnce([]); // la clave ya estaba reclamada
      keyRepo.findOneBy.mockResolvedValue(storedKey());

      const result = await runIdempotent(manager, scope(), work, load);

      expect(result).toEqual({ id: 'thing-9', loaded: true });
      expect(load).toHaveBeenCalledWith('thing-9');
      expect(work).not.toHaveBeenCalled();
      expect(keyRepo.findOneBy).toHaveBeenCalledWith({
        companyId: COMPANY,
        userId: USER,
        operation: 'createThing',
        key: 'key-12345678',
      });
      // Solo el intento de reclamar: no se vuelve a vincular nada
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('rejects the same key with other data, without doing the work or returning the old resource', async () => {
      const { manager, query, keyRepo } = createManager();
      const { work, load } = createWork();
      query.mockResolvedValueOnce([]);
      keyRepo.findOneBy.mockResolvedValue(storedKey());

      const error = await runIdempotent(
        manager,
        scope({ input: { name: 'Ana', amount: 99 } }),
        work,
        load,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toContain('otros datos');
      expect(work).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    });

    it('tells a retry that the operation is still in progress when the claim has no resource yet', async () => {
      const { manager, query, keyRepo } = createManager();
      const { work, load } = createWork();
      query.mockResolvedValueOnce([]);
      keyRepo.findOneBy.mockResolvedValue(storedKey({ resourceId: null }));

      const error = await runIdempotent(manager, scope(), work, load).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toContain('en curso');
      expect(work).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    });

    it('also answers "in progress" when the claim can no longer be read', async () => {
      const { manager, query, keyRepo } = createManager();
      const { work, load } = createWork();
      query.mockResolvedValueOnce([]);
      keyRepo.findOneBy.mockResolvedValue(null);

      const error = await runIdempotent(manager, scope(), work, load).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toContain('en curso');
      expect(work).not.toHaveBeenCalled();
    });

    it('does not swallow a failure of the work: the caller’s transaction rolls back the claim with it', async () => {
      const { manager, query } = createManager();
      const { work, load } = createWork();
      const failure = new Error('boom');
      work.mockRejectedValue(failure);

      await expect(runIdempotent(manager, scope(), work, load)).rejects.toBe(failure);

      // Solo se reclamó la clave; no se vinculó ningún recurso
      expect(query).toHaveBeenCalledTimes(1);
      expect(load).not.toHaveBeenCalled();
    });

    it('lets a business error of the work through as it is', async () => {
      const { manager } = createManager();
      const { work, load } = createWork();
      const failure = new ConflictException('Ya existe');
      work.mockRejectedValue(failure);

      await expect(runIdempotent(manager, scope(), work, load)).rejects.toBe(failure);
    });

    it('sometimes takes the chance to delete the keys older than a week, on another connection', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const { manager, query, connection } = createManager();
      const { work, load } = createWork();

      await runIdempotent(manager, scope(), work, load);

      expect(IDEMPOTENCY_RETENTION_DAYS).toBe(7);
      expect(connection.query).toHaveBeenCalledTimes(1);
      const [sql] = connection.query.mock.calls[0] as unknown as [string];
      expect(sql).toContain('DELETE FROM "idempotency_keys"');
      expect(sql).toContain("interval '7 days'");
      // Ni el INSERT ni el UPDATE de la operación pasan por ahí
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('does not delete anything most of the time', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.01);
      const { manager, connection } = createManager();
      const { work, load } = createWork();

      await runIdempotent(manager, scope(), work, load);

      expect(connection.query).not.toHaveBeenCalled();
    });

    it('does not fail the operation when the cleanup fails', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const { manager, connection } = createManager();
      const { work, load } = createWork();
      connection.query.mockRejectedValue(new Error('base caída'));

      await expect(runIdempotent(manager, scope(), work, load)).resolves.toEqual({ id: 'thing-1' });
    });

    describe('with a table that behaves like the unique index', () => {
      it('does the work once when the same request comes twice, and answers the second with the first’s resource', async () => {
        const { manager } = createInMemoryManager();
        const { work, load } = createWork();

        const first = await runIdempotent(manager, scope(), work, load);
        const second = await runIdempotent(manager, scope(), work, load);

        expect(work).toHaveBeenCalledTimes(1);
        expect(first).toEqual({ id: 'thing-1' });
        expect(second).toEqual({ id: 'thing-1', loaded: true });
        expect(load).toHaveBeenCalledWith('thing-1');
      });

      it('does not confuse the same key on another operation, for another user or in another company', async () => {
        const { manager } = createInMemoryManager();
        const { work, load } = createWork();

        await runIdempotent(manager, scope(), work, load);
        await runIdempotent(manager, scope({ operation: 'otherThing' }), work, load);
        await runIdempotent(manager, scope({ userId: 'user-2' }), work, load);
        await runIdempotent(manager, scope({ companyId: 'company-2' }), work, load);

        expect(work).toHaveBeenCalledTimes(4);
        expect(load).not.toHaveBeenCalled();
      });

      it('rejects the second request when it arrives with the same key but other data', async () => {
        const { manager } = createInMemoryManager();
        const { work, load } = createWork();

        await runIdempotent(manager, scope(), work, load);
        const error = await runIdempotent(
          manager,
          scope({ input: { name: 'Otra persona', amount: 10 } }),
          work,
          load,
        ).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ConflictException);
        expect(work).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('findIdempotentResource', () => {
    it('answers null, without asking the database, when the request carries no key', async () => {
      const { manager, keyRepo, query } = createManager();
      const { load } = createWork();

      await expect(
        findIdempotentResource(manager, scope({ key: undefined }), load),
      ).resolves.toBeNull();
      expect(keyRepo.findOneBy).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    });

    it('answers null when the operation with that key was never done', async () => {
      const { manager, keyRepo } = createManager();
      const { load } = createWork();

      await expect(findIdempotentResource(manager, scope(), load)).resolves.toBeNull();
      expect(keyRepo.findOneBy).toHaveBeenCalledWith({
        companyId: COMPANY,
        userId: USER,
        operation: 'createThing',
        key: 'key-12345678',
      });
      expect(load).not.toHaveBeenCalled();
    });

    it('returns the resource the operation created, as it is now', async () => {
      const { manager, keyRepo } = createManager();
      const { load } = createWork();
      keyRepo.findOneBy.mockResolvedValue(storedKey());

      await expect(findIdempotentResource(manager, scope(), load)).resolves.toEqual({
        id: 'thing-9',
        loaded: true,
      });
      expect(load).toHaveBeenCalledWith('thing-9');
    });

    it('does not claim the key: it only looks', async () => {
      const { manager, keyRepo, query } = createManager();
      const { load } = createWork();
      keyRepo.findOneBy.mockResolvedValue(storedKey());

      await findIdempotentResource(manager, scope(), load);

      expect(query).not.toHaveBeenCalled();
    });

    it('rejects the same key with other data', async () => {
      const { manager, keyRepo } = createManager();
      const { load } = createWork();
      keyRepo.findOneBy.mockResolvedValue(storedKey());

      const error = await findIdempotentResource(
        manager,
        scope({ input: { name: 'Ana', amount: 99 } }),
        load,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toContain('otros datos');
      expect(load).not.toHaveBeenCalled();
    });

    it('answers null when the key exists but has no resource yet', async () => {
      const { manager, keyRepo } = createManager();
      const { load } = createWork();
      keyRepo.findOneBy.mockResolvedValue(storedKey({ resourceId: null }));

      await expect(findIdempotentResource(manager, scope(), load)).resolves.toBeNull();
      expect(load).not.toHaveBeenCalled();
    });
  });
});
