import { ConflictException, NotFoundException } from '@nestjs/common';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { Location } from '../location/entities/location.entity.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { IncidentStatus } from './entities/incident-status.enum.js';
import { IncidentType } from './entities/incident-type.enum.js';
import { IncidentService } from './incident.service.js';

const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

function createService() {
  // Query builder encadenable para la lectura acotada al proveedor (findAll/findOne con supplierId).
  const qb = {
    where: vi.fn(() => qb),
    andWhere: vi.fn(() => qb),
    orderBy: vi.fn(() => qb),
    getMany: vi.fn().mockResolvedValue([]),
    getOne: vi.fn().mockResolvedValue(null),
  };
  const repo = {
    find: vi.fn().mockResolvedValue([]),
    findOneBy: vi.fn(),
    createQueryBuilder: vi.fn(() => qb),
  };
  const txIncidentRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'incident-1', ...value })),
    findOne: vi.fn(),
    findOneByOrFail: vi.fn(),
  };
  const locationRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const variantRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === Location
        ? locationRepo
        : entity === ProductVariant
          ? variantRepo
          : entity === IdempotencyKey
            ? idempotencyRepo
            : txIncidentRepo,
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };
  const service = new IncidentService(repo as never, dataSource as never);
  return {
    service,
    repo,
    qb,
    txIncidentRepo,
    locationRepo,
    variantRepo,
    idempotencyRepo,
    manager,
    dataSource,
  };
}

const COMPANY = 'company-1';
const USER = 'user-1';
const input = { type: IncidentType.INSUFFICIENT_STOCK, title: 'Faltan 2 pares talla 38' };

describe('IncidentService', () => {
  describe('findAll', () => {
    it('only lists the incidents of the company', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({ where: { companyId: COMPANY }, order: { createdAt: 'DESC' } });
    });

    // El proveedor solo ve las novedades de las líneas de SUS órdenes (no las de otro proveedor ni las
    // de bodega o de inventario): la consulta se acota por el id del proveedor dentro de la empresa.
    it('limits a supplier to the incidents of the lines of its own orders', async () => {
      const { service, repo, qb } = createService();

      await service.findAll(COMPANY, {}, USER);

      expect(repo.find).not.toHaveBeenCalled();
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('purchase_orders'),
        expect.objectContaining({ itemType: 'PURCHASE_ORDER_ITEM', supplierId: USER }),
      );
    });
  });

  describe('findOne', () => {
    it('looks it up inside the company', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'missing')).rejects.toThrow(NotFoundException);
    });

    it('does not reveal to a supplier an incident outside its own orders', async () => {
      const { service, repo, qb } = createService();

      await expect(service.findOne(COMPANY, 'incident-of-other-supplier', USER)).rejects.toThrow(NotFoundException);

      expect(repo.findOneBy).not.toHaveBeenCalled();
      expect(qb.andWhere).toHaveBeenCalledWith('incident.id = :id', { id: 'incident-of-other-supplier' });
    });
  });

  describe('report', () => {
    it('reports an incident with no location or variant', async () => {
      const { service, txIncidentRepo } = createService();

      const incident = await service.report(COMPANY, USER, input);

      expect(txIncidentRepo.create).toHaveBeenCalledWith({
        companyId: COMPANY,
        type: IncidentType.INSUFFICIENT_STOCK,
        title: 'Faltan 2 pares talla 38',
        description: null,
        entityType: null,
        entityId: null,
        locationId: null,
        productVariantId: null,
        reportedBy: USER,
        resolvedBy: null,
        resolvedAt: null,
      });
      expect(incident.id).toBe('incident-1');
    });

    it('rejects a location of another company', async () => {
      const { service, locationRepo, txIncidentRepo } = createService();
      locationRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.report(COMPANY, USER, { ...input, locationId: 'store-9' }),
      ).rejects.toThrow(NotFoundException);
      expect(txIncidentRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a variant of another company', async () => {
      const { service, variantRepo, txIncidentRepo } = createService();
      variantRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.report(COMPANY, USER, { ...input, productVariantId: 'variant-9' }),
      ).rejects.toThrow(NotFoundException);
      expect(txIncidentRepo.save).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      it('claims the key in the same transaction as reporting, before saving anything', async () => {
        const { service, manager, dataSource, txIncidentRepo } = createService();

        await service.report(COMPANY, USER, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, USER, 'reportIncident', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txIncidentRepo.save.mock.invocationCallOrder[0],
        );
      });
    });
  });

  describe('startReview', () => {
    it('moves an open incident to IN_REVIEW', async () => {
      const { service, repo, txIncidentRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'incident-1', status: IncidentStatus.OPEN });
      txIncidentRepo.findOne.mockResolvedValue({ id: 'incident-1', status: IncidentStatus.OPEN });

      const incident = await service.startReview(COMPANY, 'incident-1');

      expect(incident.status).toBe(IncidentStatus.IN_REVIEW);
    });

    it('rejects one that is not open', async () => {
      const { service, repo, txIncidentRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'incident-1', status: IncidentStatus.IN_REVIEW });
      txIncidentRepo.findOne.mockResolvedValue({ id: 'incident-1', status: IncidentStatus.IN_REVIEW });

      await expect(service.startReview(COMPANY, 'incident-1')).rejects.toThrow(ConflictException);
      expect(txIncidentRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    it('resolves an open incident, leaving who and when', async () => {
      const { service, repo, txIncidentRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'incident-1', status: IncidentStatus.OPEN });
      txIncidentRepo.findOne.mockResolvedValue({ id: 'incident-1', status: IncidentStatus.OPEN });

      const incident = await service.resolve(COMPANY, USER, 'incident-1');

      expect(incident.status).toBe(IncidentStatus.RESOLVED);
      expect(incident.resolvedBy).toBe(USER);
      expect(incident.resolvedAt).toBeInstanceOf(Date);
    });

    it('resolves one already in review', async () => {
      const { service, repo, txIncidentRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'incident-1', status: IncidentStatus.IN_REVIEW });
      txIncidentRepo.findOne.mockResolvedValue({ id: 'incident-1', status: IncidentStatus.IN_REVIEW });

      const incident = await service.resolve(COMPANY, USER, 'incident-1');

      expect(incident.status).toBe(IncidentStatus.RESOLVED);
    });

    it('does not resolve one already closed', async () => {
      const { service, repo, txIncidentRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'incident-1', status: IncidentStatus.RESOLVED });
      txIncidentRepo.findOne.mockResolvedValue({ id: 'incident-1', status: IncidentStatus.RESOLVED });

      await expect(service.resolve(COMPANY, USER, 'incident-1')).rejects.toThrow(ConflictException);
      expect(txIncidentRepo.save).not.toHaveBeenCalled();
    });

    it('cannot reach an incident of another company', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.resolve(COMPANY, USER, 'missing')).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancels an open incident, leaving who and when', async () => {
      const { service, repo, txIncidentRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'incident-1', status: IncidentStatus.OPEN });
      txIncidentRepo.findOne.mockResolvedValue({ id: 'incident-1', status: IncidentStatus.OPEN });

      const incident = await service.cancel(COMPANY, USER, 'incident-1');

      expect(incident.status).toBe(IncidentStatus.CANCELLED);
      expect(incident.resolvedBy).toBe(USER);
    });

    it('does not cancel one already resolved', async () => {
      const { service, repo, txIncidentRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'incident-1', status: IncidentStatus.RESOLVED });
      txIncidentRepo.findOne.mockResolvedValue({ id: 'incident-1', status: IncidentStatus.RESOLVED });

      await expect(service.cancel(COMPANY, USER, 'incident-1')).rejects.toThrow(ConflictException);
      expect(txIncidentRepo.save).not.toHaveBeenCalled();
    });
  });
});
