import { ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { InventoryBalanceService } from './inventory-balance.service.js';

const STORE = 'store-1';
const WAREHOUSE = 'warehouse-1';

// Una fila de lo disponible por cajón STOCK, tal como la devuelve la consulta (de más a menos).
// `locationId`/`locationType` son la sede de ese cajón: con eso se distingue lo que está en la
// tienda que vende (se cobra) de lo que está en una bodega (se pide).
const row = (
  productVariantId: string,
  inventoryLocationId: string,
  quantity: string,
  available: string,
  locationId = STORE,
  locationType: 'STORE' | 'WAREHOUSE' = 'STORE',
) => ({
  productVariantId,
  inventoryLocationId,
  locationId,
  locationType,
  quantity,
  available,
});

function createService() {
  const query = vi.fn().mockResolvedValue([]);
  const repo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn(), manager: { query } };
  const service = new InventoryBalanceService(repo as never);
  return { service, repo, query, manager: { query } };
}

const COMPANY = 'company-1';

describe('InventoryBalanceService', () => {
  describe('findAll', () => {
    it('only lists balances of variants that belong to the company', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({ where: { productVariant: { companyId: COMPANY } } });
    });

    it('can narrow the list down by variant or inventory location', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY, {
        productVariantId: 'variant-1',
        inventoryLocationId: 'inv-loc-1',
      });

      expect(repo.find).toHaveBeenCalledWith({
        where: {
          productVariant: { companyId: COMPANY },
          productVariantId: 'variant-1',
          inventoryLocationId: 'inv-loc-1',
        },
      });
    });
  });

  describe('findOne', () => {
    it('cannot reach a balance of a variant of another company', async () => {
      const { service, repo } = createService();
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'missing')).rejects.toThrow(NotFoundException);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'missing', productVariant: { companyId: COMPANY } },
      });
    });
  });
  describe('findStockLocationForSale', () => {
    it('picks the bin of the selling store with the most AVAILABLE, not the most physical stock', async () => {
      const { service, manager } = createService();
      manager.query.mockResolvedValue([row('v1', 'loc-b', '4', '4'), row('v1', 'loc-a', '10', '1')]);

      await expect(service.findStockLocationForSale(manager as never, COMPANY, 'v1', new Decimal('3'), STORE)).resolves.toBe('loc-b');
      const [sql, params] = manager.query.mock.calls[0];
      expect(sql).toContain('inventory_reservations');
      expect(params).toEqual([COMPANY, 'STOCK', 'ACTIVE', 'v1']);
    });

    it('does not sell what the store does not have, even if a warehouse has plenty', async () => {
      const { service, manager } = createService();
      manager.query.mockResolvedValue([row('v1', 'loc-wh', '9', '9', WAREHOUSE, 'WAREHOUSE')]);

      await expect(service.findStockLocationForSale(manager as never, COMPANY, 'v1', new Decimal('1'), STORE)).rejects.toThrow(
        /no está en la tienda/,
      );
    });

    it('does not sell what another store has either', async () => {
      const { service, manager } = createService();
      manager.query.mockResolvedValue([row('v1', 'loc-other', '9', '9', 'store-2', 'STORE')]);

      await expect(service.findStockLocationForSale(manager as never, COMPANY, 'v1', new Decimal('1'), STORE)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('says the units are held by another sale when the stock is there but reserved', async () => {
      const { service, manager } = createService();
      manager.query.mockResolvedValue([row('v1', 'loc-a', '2', '0')]);

      await expect(service.findStockLocationForSale(manager as never, COMPANY, 'v1', new Decimal('1'), STORE)).rejects.toThrow(
        /Otro vendedor tiene apartadas esas unidades/,
      );
    });

    it('does not split a line across bins: refuses if no single bin of the store has enough', async () => {
      const { service, manager } = createService();
      manager.query.mockResolvedValue([row('v1', 'loc-a', '1', '1'), row('v1', 'loc-b', '1', '1')]);

      await expect(service.findStockLocationForSale(manager as never, COMPANY, 'v1', new Decimal('2'), STORE)).rejects.toThrow(
        ConflictException,
      );
    });

    it('is not found when the variant has no stock anywhere', async () => {
      const { service, manager } = createService();

      await expect(service.findStockLocationForSale(manager as never, COMPANY, 'v1', new Decimal('1'), STORE)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findSellableStock', () => {
    it('separates what the store can charge from what it has to order, and leaves out what has nothing anywhere', async () => {
      const { service, query } = createService();
      query.mockResolvedValue([
        row('v1', 'loc-store', '5', '5'),
        row('v1', 'loc-wh', '8', '8', WAREHOUSE, 'WAREHOUSE'),
        row('v2', 'loc-wh', '3', '3', WAREHOUSE, 'WAREHOUSE'),
        row('v3', 'loc-store', '1', '0'),
      ]);

      const sellable = await service.findSellableStock(COMPANY, STORE);

      expect(
        sellable.map(({ productVariantId, availableQuantity, warehouseQuantity }) => [
          productVariantId,
          availableQuantity.toFixed(0),
          warehouseQuantity.toFixed(0),
        ]),
      ).toEqual([
        // En la tienda hay 5 (se cobran) y en bodega 8 (se piden).
        ['v1', '5', '8'],
        // Solo en bodega: no se cobra, se pide.
        ['v2', '0', '3'],
      ]);
      expect(query.mock.calls[0][1]).toEqual([COMPANY, 'STOCK', 'ACTIVE']);
    });
  });
});
