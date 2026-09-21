import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { PaymentMethod } from '../payment-method/entities/payment-method.entity.js';
import { CreateStorePaymentMethodInput } from './dto/create-store-payment-method.input.js';
import { StorePaymentMethod } from './entities/store-payment-method.entity.js';

const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

// La relación no lleva empresa propia: es la de su tienda. Todo se hace dentro de la empresa
// activa, así que una fila de una tienda de otra empresa se responde como si no existiera.
@Injectable()
export class StorePaymentMethodService {
  constructor(
    @InjectRepository(StorePaymentMethod)
    private readonly storePaymentMethodRepository: Repository<StorePaymentMethod>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(
    companyId: string,
    storeId?: string,
    status?: RecordStatus,
  ): Promise<StorePaymentMethod[]> {
    return this.storePaymentMethodRepository.find({
      where: {
        store: { companyId },
        ...(storeId && { storeId }),
        ...(status && { status }),
      },
    });
  }

  async findOne(companyId: string, id: string): Promise<StorePaymentMethod> {
    const row = await this.storePaymentMethodRepository.findOneBy({ id, store: { companyId } });
    if (!row) throw new NotFoundException(`Medio de pago de tienda ${id} no encontrado`);
    return row;
  }

  // La tienda tiene que ser una tienda (no una bodega) de la empresa, y el medio, de la empresa.
  async create(companyId: string, input: CreateStorePaymentMethodInput): Promise<StorePaymentMethod> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const store = await manager.getRepository(Location).findOneBy({
          id: input.storeId,
          companyId,
          type: LocationType.STORE,
        });
        if (!store) throw new NotFoundException(`Tienda ${input.storeId} no encontrada`);

        const method = await manager.getRepository(PaymentMethod).findOneBy({
          id: input.paymentMethodId,
          companyId,
        });
        if (!method) throw new NotFoundException(`Medio de pago ${input.paymentMethodId} no encontrado`);

        const repo = manager.getRepository(StorePaymentMethod);
        return repo.save(repo.create({ storeId: store.id, paymentMethodId: method.id }));
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async deactivate(companyId: string, id: string): Promise<StorePaymentMethod> {
    return this.setStatus(companyId, id, RecordStatus.INACTIVE);
  }

  // Se reactiva en vez de crear otra fila: el índice único (tienda, medio) no distingue estado.
  async activate(companyId: string, id: string): Promise<StorePaymentMethod> {
    return this.setStatus(companyId, id, RecordStatus.ACTIVE);
  }

  private async setStatus(
    companyId: string,
    id: string,
    status: RecordStatus,
  ): Promise<StorePaymentMethod> {
    const row = await this.findOne(companyId, id);
    row.status = status;
    return this.dataSource.transaction((manager) =>
      manager.getRepository(StorePaymentMethod).save(row),
    );
  }

  private mapWriteError(error: unknown): Error {
    if (!(error instanceof QueryFailedError)) return error as Error;
    const code = (error.driverError as { code?: string } | undefined)?.code;

    if (code === FOREIGN_KEY_VIOLATION) {
      return new BadRequestException('La tienda o el medio de pago indicado no existe');
    }
    if (code === UNIQUE_VIOLATION) {
      return new ConflictException('Esta tienda ya tiene ese medio de pago: actívalo en vez de crearlo');
    }
    return error as Error;
  }
}
