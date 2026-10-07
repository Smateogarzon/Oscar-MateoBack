import { ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { InventoryBalanceService } from './inventory-balance.service.js';

// Una fila de lo disponible por bodega STOCK, tal como la devuelve la consulta (de más a menos).
const row = (productVariantId: string, inventoryLocationId: string, quantity: string, available: string) => ({
  productVariantId,
  inventoryLocationId,
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
    it('picks the STOCK location with the most AVAILABLE, not the most physical stock', async () => {
      const { service, manager } = createService();
      manager.query.mockResolvedValue([row('v1', 'loc-b', '4', '4'), row('v1', 'loc-a', '10', '1')]);

      await expect(service.findStockLocationForSale(manager as never, COMPANY, 'v1', new Decimal('3'))).resolves.toBe('loc-b');
      const [sql, params] = manager.query.mock.calls[0];
      expect(sql).toContain('inventory_reservations');
      expect(params).toEqual([COMPANY, 'STOCK', 'ACTIVE', 'v1']);
    });

    it('says the units are held by another sale when the stock is there but reserved', async () => {
      const { service, manager } = createService();
      manager.query.mockResolvedValue([row('v1', 'loc-a', '2', '0')]);

      await expect(service.findStockLocationForSale(manager as never, COMPANY, 'v1', new Decimal('1'))).rejects.toThrow(
        /Otro vendedor tiene apartadas esas unidades/,
      );
    });

    it('does not split a line across locations: refuses if no single location has enough', async () => {
      const { service, manager } = createService();
      manager.query.mockResolvedValue([row('v1', 'loc-a', '1', '1'), row('v1', 'loc-b', '1', '1')]);

      await expect(service.findStockLocationForSale(manager as never, COMPANY, 'v1', new Decimal('2'))).rejects.toThrow(
        ConflictException,
      );
    });

    it('is not found when the variant has no stock in any STOCK location', async () => {
      const { service, manager } = createService();

      await expect(service.findStockLocationForSale(manager as never, COMPANY, 'v1', new Decimal('1'))).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findSellableStock', () => {
    it('gives each variant the best single location (the most a sale line can take), and leaves out what has nothing left', async () => {
      const { service, query } = createService();
      query.mockResolvedValue([
        row('v1', 'loc-a', '5', '5'),
        row('v2', 'loc-a', '3', '3'),
        row('v1', 'loc-b', '8', '2'),
        row('v3', 'loc-a', '1', '0'),
      ]);

      const sellable = await service.findSellableStock(COMPANY);

      expect(sellable.map(({ productVariantId, availableQuantity }) => [productVariantId, availableQuantity.toFixed(0)])).toEqual([
        ['v1', '5'],
        ['v2', '3'],
      ]);
      expect(query.mock.calls[0][1]).toEqual([COMPANY, 'STOCK', 'ACTIVE']);
    });
  });
});
