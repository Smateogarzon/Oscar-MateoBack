import { NotFoundException } from '@nestjs/common';
import { InventorySide } from './entities/inventory-side.enum.js';
import { InventoryBalanceService } from './inventory-balance.service.js';

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn() };
  const service = new InventoryBalanceService(repo as never);
  return { service, repo };
}

const COMPANY = 'company-1';

describe('InventoryBalanceService', () => {
  describe('findAll', () => {
    it('only lists balances of variants that belong to the company', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({ where: { productVariant: { companyId: COMPANY } } });
    });

    it('can narrow the list down by variant, inventory location or side', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY, {
        productVariantId: 'variant-1',
        inventoryLocationId: 'inv-loc-1',
        side: InventorySide.LEFT,
      });

      expect(repo.find).toHaveBeenCalledWith({
        where: {
          productVariant: { companyId: COMPANY },
          productVariantId: 'variant-1',
          inventoryLocationId: 'inv-loc-1',
          side: InventorySide.LEFT,
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
});
