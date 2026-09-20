import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CreatePaymentMethodInput } from './dto/create-payment-method.input.js';
import { UpdatePaymentMethodInput } from './dto/update-payment-method.input.js';
import { PaymentMethod } from './entities/payment-method.entity.js';

const UNIQUE_VIOLATION = '23505';

// Todo se hace dentro de la empresa activa: un medio de pago de otra empresa se responde igual
// que uno que no existe. Desactivar un medio no toca los pagos ya hechos con él: solo deja de
// ofrecerse al cobrar. Se puede reactivar porque el nombre no se reutiliza (índice único).
@Injectable()
export class PaymentMethodService {
  constructor(
    @InjectRepository(PaymentMethod)
    private readonly paymentMethodRepository: Repository<PaymentMethod>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(companyId: string, status?: RecordStatus): Promise<PaymentMethod[]> {
    return this.paymentMethodRepository.find({
      where: { companyId, ...(status && { status }) },
      order: { name: 'ASC' },
    });
  }

  async findOne(companyId: string, id: string): Promise<PaymentMethod> {
    const method = await this.paymentMethodRepository.findOneBy({ id, companyId });
    if (!method) throw new NotFoundException(`Medio de pago ${id} no encontrado`);
    return method;
  }

  async create(companyId: string, input: CreatePaymentMethodInput): Promise<PaymentMethod> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('El nombre del medio de pago no puede estar vacío');

    try {
      return await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(PaymentMethod);
        if (await repo.existsBy({ companyId, name })) throw this.duplicateName();

        return repo.save(
          repo.create({
            companyId,
            name,
            type: input.type,
            requiresReference: input.requiresReference ?? false,
          }),
        );
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  // Solo el nombre y si exige referencia: el tipo no cambia (ver PaymentMethod.type).
  async update(
    companyId: string,
    id: string,
    input: UpdatePaymentMethodInput,
  ): Promise<PaymentMethod> {
    const name = input.name?.trim();
    if (input.name != null && !name) {
      throw new BadRequestException('El nombre del medio de pago no puede estar vacío');
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(PaymentMethod);
        const method = await repo.findOneBy({ id, companyId });
        if (!method) throw new NotFoundException(`Medio de pago ${id} no encontrado`);

        if (name !== undefined && name !== method.name) {
          if (await repo.existsBy({ companyId, name })) throw this.duplicateName();
          method.name = name;
        }
        if (input.requiresReference != null) method.requiresReference = input.requiresReference;

        return repo.save(method);
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  deactivate(companyId: string, id: string): Promise<PaymentMethod> {
    return this.setStatus(companyId, id, RecordStatus.INACTIVE);
  }

  activate(companyId: string, id: string): Promise<PaymentMethod> {
    return this.setStatus(companyId, id, RecordStatus.ACTIVE);
  }

  private setStatus(companyId: string, id: string, status: RecordStatus): Promise<PaymentMethod> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PaymentMethod);
      const method = await repo.findOneBy({ id, companyId });
      if (!method) throw new NotFoundException(`Medio de pago ${id} no encontrado`);

      method.status = status;
      return repo.save(method);
    });
  }

  private duplicateName(): ConflictException {
    return new ConflictException('Ya existe un medio de pago con ese nombre');
  }

  // Dos creaciones a la vez con el mismo nombre pasan la comprobación de arriba; el índice
  // único (empresa, nombre) frena a la segunda y aquí se traduce en el mismo mensaje.
  private mapWriteError(error: unknown): Error {
    if (!(error instanceof QueryFailedError)) return error as Error;
    const code = (error.driverError as { code?: string } | undefined)?.code;
    return code === UNIQUE_VIOLATION ? this.duplicateName() : (error as Error);
  }
}
