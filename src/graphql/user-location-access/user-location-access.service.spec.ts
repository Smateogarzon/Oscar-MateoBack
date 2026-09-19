import { NotFoundException } from '@nestjs/common';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { UserLocationAccessService } from './user-location-access.service.js';

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const locationRepo = { findOneBy: vi.fn() };
  const membershipRepo = { existsBy: vi.fn() };
  const accessRepo = {
    create: vi.fn((data: object) => data),
    save: vi.fn(async (access: object) => ({ id: 'access-1', ...access })),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({
        getRepository: (entity: unknown) =>
          entity === Location ? locationRepo : entity === UserCompanyRole ? membershipRepo : accessRepo,
      }),
    ),
  };
  const service = new UserLocationAccessService(repo as never, dataSource as never);
  return { service, repo, locationRepo, membershipRepo, accessRepo, dataSource };
}

const COMPANY = 'company-1';
const input = { userId: 'user-1', locationId: 'location-1' };

describe('UserLocationAccessService', () => {
  describe('findAll', () => {
    it('only lists accesses to locations of the company', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({ where: { location: { companyId: COMPANY } } });
    });

    it('can narrow the list down by user, location and status', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY, 'user-1', 'location-1', RecordStatus.ACTIVE);

      expect(repo.find).toHaveBeenCalledWith({
        where: {
          location: { companyId: COMPANY },
          userId: 'user-1',
          locationId: 'location-1',
          status: RecordStatus.ACTIVE,
        },
      });
    });
  });

  describe('findOne', () => {
    it('looks the access up through the company of its location', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'access-9')).rejects.toThrow(NotFoundException);
      expect(repo.findOneBy).toHaveBeenCalledWith({
        id: 'access-9',
        location: { companyId: COMPANY },
      });
    });
  });

  describe('create', () => {
    it('does not grant access to a location of another company', async () => {
      const { service, locationRepo, accessRepo } = createService();
      locationRepo.findOneBy.mockResolvedValue(null);

      await expect(service.create(COMPANY, input)).rejects.toThrow(NotFoundException);
      expect(locationRepo.findOneBy).toHaveBeenCalledWith({ id: 'location-1', companyId: COMPANY });
      expect(accessRepo.save).not.toHaveBeenCalled();
    });

    it('does not grant access to someone who is not an active member of the company', async () => {
      const { service, locationRepo, membershipRepo, accessRepo } = createService();
      locationRepo.findOneBy.mockResolvedValue({ id: 'location-1' });
      membershipRepo.existsBy.mockResolvedValue(false);

      await expect(service.create(COMPANY, input)).rejects.toThrow(NotFoundException);
      expect(membershipRepo.existsBy).toHaveBeenCalledWith({
        userId: 'user-1',
        companyId: COMPANY,
        status: RecordStatus.ACTIVE,
      });
      expect(accessRepo.save).not.toHaveBeenCalled();
    });

    it('grants access to an active member on a location of the company, inside a transaction', async () => {
      const { service, locationRepo, membershipRepo, dataSource } = createService();
      locationRepo.findOneBy.mockResolvedValue({ id: 'location-1' });
      membershipRepo.existsBy.mockResolvedValue(true);

      const access = await service.create(COMPANY, input);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(access).toMatchObject(input);
    });
  });

  describe('activate and deactivate', () => {
    it('deactivates an access of the company', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'access-1', status: RecordStatus.ACTIVE });

      const result = await service.deactivate(COMPANY, 'access-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.status).toBe(RecordStatus.INACTIVE);
    });

    it('reactivates an access of the company', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'access-1', status: RecordStatus.INACTIVE });

      const result = await service.activate(COMPANY, 'access-1');

      expect(result.status).toBe(RecordStatus.ACTIVE);
    });

    it('cannot reach an access of another company by id', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate(COMPANY, 'access-9')).rejects.toThrow(NotFoundException);
      await expect(service.activate(COMPANY, 'access-9')).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
