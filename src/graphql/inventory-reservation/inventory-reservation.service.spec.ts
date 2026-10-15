import { ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { InventoryBalance } from '../inventory-balance/entities/inventory-balance.entity.js';
import { InventoryLocation } from '../inventory-location/entities/inventory-location.entity.js';
import { InventorySourceType } from '../inventory-movement/entities/inventory-source-type.enum.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { InventoryReservationService } from './inventory-reservation.service.js';

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn(), delete: vi.fn() };
  const txReservationRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'reservation-1', ...value })),
    // Lo que el documento ya tenía apartado, para syncForSource.
    findBy: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const variantRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const invLocationRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const balanceRepo = {
    findOne: vi.fn().mockResolvedValue({
      id: 'bal-1',
      productVariantId: 'variant-1',
      inventoryLocationId: 'inv-loc-1',
      quantity: new Decimal('10'),
    }),
  };
  // Por defecto nada reservado todavía; cada prueba de "ya hay reservas" lo ajusta.
  const queryMock = vi.fn(async (sql: string) =>
    sql.includes('inventory_balances') ? [] : [{ sum: '0' }],
  );
  const manager = {
    getRepository: (entity: unknown) =>
      entity === ProductVariant
        ? variantRepo
        : entity === InventoryLocation
          ? invLocationRepo
          : entity === InventoryBalance
            ? balanceRepo
            : txReservationRepo,
    query: queryMock,
  };
  // Elegir bodega es de InventoryBalanceService; aquí solo importa cuál devuelve.
  const balances = {
    findStockLocationForSale: vi.fn().mockResolvedValue('inv-loc-1'),
  };
  const service = new InventoryReservationService(repo as never, balances as never);
  return { service, repo, txReservationRepo, variantRepo, invLocationRepo, balanceRepo, manager, queryMock, balances };
}

const COMPANY = 'company-1';
const USER = 'user-1';
const SALE = { sourceType: InventorySourceType.SALE, sourceId: 'sale-1', reservedBy: USER };

const reserveParams = (overrides: Record<string, unknown> = {}) => ({
  productVariantId: 'variant-1',
  inventoryLocationId: 'inv-loc-1',
  quantity: new Decimal('4'),
  sourceType: InventorySourceType.SALE,
  sourceId: 'sale-1',
  reservedBy: USER,
  ...overrides,
});

describe('InventoryReservationService', () => {
  describe('findAll', () => {
    it('only lists reservations of variants that belong to the company, with who holds them', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({
        where: { productVariant: { companyId: COMPANY } },
        relations: { reservedByUser: true },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    it('cannot reach a reservation of a variant of another company', async () => {
      const { service, repo } = createService();
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('reserveInTransaction', () => {
    it('reserves the amount when it fits in what is available, noting who holds it', async () => {
      const { service, manager, txReservationRepo } = createService();

      const reservation = await service.reserveInTransaction(manager as never, COMPANY, reserveParams());

      expect(txReservationRepo.create).toHaveBeenCalledWith({
        productVariantId: 'variant-1',
        inventoryLocationId: 'inv-loc-1',
        quantity: expect.any(Decimal),
        sourceType: InventorySourceType.SALE,
        sourceId: 'sale-1',
        sourceNumber: null,
        reservedBy: USER,
      });
      expect(txReservationRepo.create.mock.calls[0][0].quantity.toFixed(2)).toBe('4.00');
      expect(reservation.id).toBe('reservation-1');
    });

    it('locks the balance before reading it, so two reservations at once never promise the same unit', async () => {
      const { service, manager, balanceRepo } = createService();

      await service.reserveInTransaction(manager as never, COMPANY, reserveParams());

      expect(balanceRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
    });

    it('discounts what is already reserved before deciding if it fits', async () => {
      const { service, manager, queryMock, txReservationRepo } = createService();
      queryMock.mockImplementation(async (sql: string) =>
        sql.includes('inventory_balances') ? [] : [{ sum: '7' }],
      );

      // Balanza de 10, ya reservados 7: quedan 3 disponibles, alcanza para pedir 3 pero no para 4.
      await expect(
        service.reserveInTransaction(manager as never, COMPANY, reserveParams({ quantity: new Decimal('3') })),
      ).resolves.toBeDefined();
      await expect(
        service.reserveInTransaction(manager as never, COMPANY, reserveParams({ quantity: new Decimal('4') })),
      ).rejects.toThrow(ConflictException);
      expect(txReservationRepo.save).toHaveBeenCalledTimes(1);
    });

    it('rejects when the balance itself does not have enough, even with nothing else reserved', async () => {
      const { service, manager, balanceRepo, txReservationRepo } = createService();
      balanceRepo.findOne.mockResolvedValue({
        id: 'bal-1',
        productVariantId: 'variant-1',
        inventoryLocationId: 'inv-loc-1',
        quantity: new Decimal('2'),
      });

      await expect(
        service.reserveInTransaction(manager as never, COMPANY, reserveParams({ quantity: new Decimal('3') })),
      ).rejects.toThrow(ConflictException);
      expect(txReservationRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a variant of another company', async () => {
      const { service, manager, variantRepo, txReservationRepo } = createService();
      variantRepo.existsBy.mockResolvedValue(false);

      await expect(service.reserveInTransaction(manager as never, COMPANY, reserveParams())).rejects.toThrow(
        NotFoundException,
      );
      expect(txReservationRepo.save).not.toHaveBeenCalled();
    });

    it('rejects an inventory location of another company', async () => {
      const { service, manager, invLocationRepo, txReservationRepo } = createService();
      invLocationRepo.existsBy.mockResolvedValue(false);

      await expect(service.reserveInTransaction(manager as never, COMPANY, reserveParams())).rejects.toThrow(
        NotFoundException,
      );
      expect(txReservationRepo.save).not.toHaveBeenCalled();
    });
  });

  // Lo que mantiene a la venta y lo apartado siempre iguales: es lo que bloquea el último par para el
  // vendedor que lo tomó primero.
  describe('syncForSource', () => {
    it('reserves what the document asks for, at the location with the most available', async () => {
      const { service, manager, txReservationRepo, balances } = createService();

      await service.syncForSource(manager as never, COMPANY, SALE, new Map([['variant-1', new Decimal('2')]]));

      expect(balances.findStockLocationForSale).toHaveBeenCalledWith(
        manager,
        COMPANY,
        'variant-1',
        expect.any(Decimal),
      );
      expect(txReservationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ productVariantId: 'variant-1', inventoryLocationId: 'inv-loc-1', reservedBy: USER }),
      );
    });

    it('leaves an unchanged reservation alone: it does not let go of the unit and take it again', async () => {
      const { service, manager, txReservationRepo } = createService();
      txReservationRepo.findBy.mockResolvedValue([
        { id: 'res-1', productVariantId: 'variant-1', quantity: new Decimal('2') },
      ]);

      await service.syncForSource(manager as never, COMPANY, SALE, new Map([['variant-1', new Decimal('2')]]));

      expect(txReservationRepo.remove).not.toHaveBeenCalled();
      expect(txReservationRepo.save).not.toHaveBeenCalled();
    });

    it('re-reserves when the quantity changed', async () => {
      const { service, manager, txReservationRepo } = createService();
      txReservationRepo.findBy.mockResolvedValue([
        { id: 'res-1', productVariantId: 'variant-1', quantity: new Decimal('2') },
      ]);

      await service.syncForSource(manager as never, COMPANY, SALE, new Map([['variant-1', new Decimal('5')]]));

      expect(txReservationRepo.remove).toHaveBeenCalledWith([expect.objectContaining({ id: 'res-1' })]);
      expect(txReservationRepo.create.mock.calls[0][0].quantity.toFixed(2)).toBe('5.00');
    });

    it('releases what the document no longer asks for, so the product frees up at once', async () => {
      const { service, manager, txReservationRepo } = createService();
      txReservationRepo.findBy.mockResolvedValue([
        { id: 'res-1', productVariantId: 'variant-1', quantity: new Decimal('2') },
      ]);

      await service.syncForSource(manager as never, COMPANY, SALE, new Map());

      expect(txReservationRepo.remove).toHaveBeenCalledWith([expect.objectContaining({ id: 'res-1' })]);
      expect(txReservationRepo.save).not.toHaveBeenCalled();
    });

    it('adds up several lines of the same variant into one reservation', async () => {
      const { service, manager, txReservationRepo } = createService();

      await service.syncForSource(manager as never, COMPANY, SALE, new Map([['variant-1', new Decimal('3')]]));

      expect(txReservationRepo.save).toHaveBeenCalledTimes(1);
      expect(txReservationRepo.create.mock.calls[0][0].quantity.toFixed(2)).toBe('3.00');
    });
  });

  describe('findForSource', () => {
    it('finds what a document holds, to know which warehouse it came out of', async () => {
      const { service, manager, txReservationRepo } = createService();

      await service.findForSource(manager as never, InventorySourceType.SALE, 'sale-1');

      expect(txReservationRepo.findBy).toHaveBeenCalledWith({
        sourceType: InventorySourceType.SALE,
        sourceId: 'sale-1',
      });
    });
  });
});
