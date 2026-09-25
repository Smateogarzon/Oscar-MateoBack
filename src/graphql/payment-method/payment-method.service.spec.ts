import { NotFoundException } from '@nestjs/common';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { PaymentMethodService } from './payment-method.service.js';

const COMPANY = 'company-1';

function createService() {
  const methodRepo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const service = new PaymentMethodService(methodRepo as never);
  return { service, methodRepo };
}

describe('PaymentMethodService', () => {
  describe('findAll', () => {
    it('only lists the methods of the company, by name', async () => {
      const { service, methodRepo } = createService();

      await service.findAll(COMPANY);

      expect(methodRepo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY },
        order: { name: 'ASC' },
      });
    });

    it('can narrow the list down by status', async () => {
      const { service, methodRepo } = createService();

      await service.findAll(COMPANY, RecordStatus.ACTIVE);

      expect(methodRepo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY, status: RecordStatus.ACTIVE },
        order: { name: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    it('looks the method up inside the company, so one of another company does not exist', async () => {
      const { service, methodRepo } = createService();
      methodRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'method-9')).rejects.toThrow(NotFoundException);
      expect(methodRepo.findOneBy).toHaveBeenCalledWith({ id: 'method-9', companyId: COMPANY });
    });
  });
});
