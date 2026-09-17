import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { PermissionModule as PermissionModuleEnum } from './entities/permission-module.enum.js';
import { Permission } from './entities/permission.entity.js';

@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
  ) {}

  findAll(module?: PermissionModuleEnum, status?: RecordStatus): Promise<Permission[]> {
    return this.permissionRepository.find({
      where: { ...(module && { module }), ...(status && { status }) },
    });
  }
}
