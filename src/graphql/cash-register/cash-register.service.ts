import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CashSessionStatus } from '../cash-session/entities/cash-session-status.enum.js';
import { CashSession } from '../cash-session/entities/cash-session.entity.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { CreateCashRegisterInput } from './dto/create-cash-register.input.js';
import { UpdateCashRegisterInput } from './dto/update-cash-register.input.js';
import { CashRegister } from './entities/cash-register.entity.js';

const UNIQUE_VIOLATION = '23505';

// La caja no lleva empresa propia: es la de su tienda. Todo se hace dentro de la empresa activa,
// así que una caja de otra empresa se responde como si no existiera.
@Injectable()
export class CashRegisterService {
  constructor(
    @InjectRepository(CashRegister)
    private readonly cashRegisterRepository: Repository<CashRegister>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(
    companyId: string,
    filters: { storeId?: string; status?: RecordStatus } = {},
  ): Promise<CashRegister[]> {
    const { storeId, status } = filters;
    return this.cashRegisterRepository.find({
      where: { store: { companyId }, ...(storeId && { storeId }), ...(status && { status }) },
      order: { name: 'ASC' },
    });
  }

  async findOne(companyId: string, id: string): Promise<CashRegister> {
    const register = await this.cashRegisterRepository.findOne({
      where: { id, store: { companyId } },
    });
    if (!register) throw new NotFoundException(`Caja ${id} no encontrada`);
    return register;
  }

  async create(companyId: string, input: CreateCashRegisterInput): Promise<CashRegister> {
    const name = input.name.trim();
    const code = input.code.trim();
    if (!name || !code) {
      throw new BadRequestException('El nombre y el código de la caja no pueden estar vacíos');
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        // La caja está en una tienda (no en una bodega) de la empresa. Se busca sin filtrar por
        // estado, a propósito: una tienda desactivada sí existe, y responder "no encontrada"
        // mandaría a buscar el problema donde no está. Una de otra empresa sigue respondiéndose
        // como inexistente (el filtro por `companyId` no se toca).
        const store = await manager.getRepository(Location).findOneBy({
          id: input.storeId,
          companyId,
          type: LocationType.STORE,
        });
        if (!store) throw new NotFoundException(`Tienda ${input.storeId} no encontrada`);
        if (store.status !== RecordStatus.ACTIVE) {
          throw new ConflictException(
            `La tienda ${store.name} está desactivada: no se pueden crear cajas en ella`,
          );
        }

        const repo = manager.getRepository(CashRegister);
        if (await repo.existsBy({ storeId: store.id, code })) throw this.duplicateCode();

        return repo.save(repo.create({ storeId: store.id, name, code }));
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  // Solo el nombre y el código: la caja no cambia de tienda.
  async update(
    companyId: string,
    id: string,
    input: UpdateCashRegisterInput,
  ): Promise<CashRegister> {
    const name = input.name?.trim();
    const code = input.code?.trim();
    if ((input.name != null && !name) || (input.code != null && !code)) {
      throw new BadRequestException('El nombre y el código de la caja no pueden estar vacíos');
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(CashRegister);
        const register = await repo.findOne({ where: { id, store: { companyId } } });
        if (!register) throw new NotFoundException(`Caja ${id} no encontrada`);

        if (code !== undefined && code !== register.code) {
          if (await repo.existsBy({ storeId: register.storeId, code })) throw this.duplicateCode();
          register.code = code;
        }
        if (name !== undefined) register.name = name;

        return repo.save(register);
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  // Una caja con un turno abierto no se desactiva: primero se cierra el turno. La caja se bloquea
  // igual que al abrir un turno (CashSessionService.open), así una apertura que llegue a la vez
  // espera y encuentra la caja ya desactivada.
  async deactivate(companyId: string, id: string): Promise<CashRegister> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CashRegister);
      const found = await repo.findOne({ where: { id, store: { companyId } } });
      if (!found) throw new NotFoundException(`Caja ${id} no encontrada`);

      const register = await repo.findOne({ where: { id: found.id }, lock: { mode: 'pessimistic_write' } });
      if (!register) throw new NotFoundException(`Caja ${id} no encontrada`);

      const hasOpenSession = await manager.getRepository(CashSession).existsBy({
        cashRegisterId: register.id,
        status: CashSessionStatus.OPEN,
      });
      if (hasOpenSession) {
        throw new ConflictException('La caja tiene un turno abierto: ciérralo antes de desactivarla');
      }

      register.status = RecordStatus.INACTIVE;
      return repo.save(register);
    });
  }

  async activate(companyId: string, id: string): Promise<CashRegister> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CashRegister);
      const register = await repo.findOne({ where: { id, store: { companyId } } });
      if (!register) throw new NotFoundException(`Caja ${id} no encontrada`);

      register.status = RecordStatus.ACTIVE;
      return repo.save(register);
    });
  }

  private duplicateCode(): ConflictException {
    return new ConflictException('Ya hay una caja con ese código en la tienda');
  }

  // Dos cambios a la vez con el mismo código pasan la comprobación de arriba; el índice único
  // (tienda, código) frena al segundo y aquí se traduce en el mismo mensaje.
  private mapWriteError(error: unknown): Error {
    if (!(error instanceof QueryFailedError)) return error as Error;
    const code = (error.driverError as { code?: string } | undefined)?.code;
    return code === UNIQUE_VIOLATION ? this.duplicateCode() : (error as Error);
  }
}
