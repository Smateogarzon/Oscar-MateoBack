import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { mapPostgresWriteError } from '../../common/utils/postgres-error.js';
import { CashSessionStatus } from '../cash-session/entities/cash-session-status.enum.js';
import { CashSession } from '../cash-session/entities/cash-session.entity.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { nextCashRegisterCode } from './default-cash-register.js';
import { CreateCashRegisterInput } from './dto/create-cash-register.input.js';
import { UpdateCashRegisterInput } from './dto/update-cash-register.input.js';
import { CashRegister } from './entities/cash-register.entity.js';

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

  // El código no se escribe: lo asigna el servidor, consecutivo dentro de la tienda (C1, C2, C3...;
  // ver nextCashRegisterCode). La fila de la tienda se bloquea mientras se calcula y se guarda, así
  // dos cajas creadas a la vez en la misma tienda no toman el mismo número. Con `idempotencyKey`, repetir
  // la petición (doble clic en "Crear caja") devuelve la caja ya creada en vez de crear otra con el
  // código siguiente.
  async create(
    companyId: string,
    userId: string,
    input: CreateCashRegisterInput,
    idempotencyKey?: string,
  ): Promise<CashRegister> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('El nombre de la caja no puede estar vacío');

    try {
      return await this.dataSource.transaction((manager) =>
        runIdempotent(
          manager,
          {
            companyId,
            userId,
            operation: 'createCashRegister',
            key: idempotencyKey,
            input,
            resourceType: 'cash_register',
          },
          async () => {
            // La caja está en una tienda (no en una bodega) de la empresa. Se busca sin filtrar por
            // estado, a propósito: una tienda desactivada sí existe, y responder "no encontrada"
            // mandaría a buscar el problema donde no está. Una de otra empresa sigue respondiéndose
            // como inexistente (el filtro por `companyId` no se toca).
            const store = await manager.getRepository(Location).findOne({
              where: { id: input.storeId, companyId, type: LocationType.STORE },
              lock: { mode: 'pessimistic_write' },
            });
            if (!store) throw new NotFoundException(`Tienda ${input.storeId} no encontrada`);
            if (store.status !== RecordStatus.ACTIVE) {
              throw new ConflictException(
                `La tienda ${store.name} está desactivada: no se pueden crear cajas en ella`,
              );
            }

            const repo = manager.getRepository(CashRegister);
            // Todas las cajas de la tienda, también las desactivadas: su código sigue siendo suyo.
            const used = await repo.find({ where: { storeId: store.id }, select: { code: true } });
            const code = nextCashRegisterCode(used.map((register) => register.code));

            return repo.save(repo.create({ storeId: store.id, name, code }));
          },
          (id) => manager.getRepository(CashRegister).findOneByOrFail({ id }),
        ),
      );
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  // Solo el nombre: la caja no cambia de tienda y su código es fijo (lo asignó el servidor al crearla).
  async update(
    companyId: string,
    id: string,
    input: UpdateCashRegisterInput,
  ): Promise<CashRegister> {
    const name = input.name?.trim();
    if (input.name != null && !name) {
      throw new BadRequestException('El nombre de la caja no puede estar vacío');
    }

    return this.dataSource.transaction(async (manager) => {
      const register = await this.lockRegister(manager, companyId, id);

      if (name !== undefined) register.name = name;
      return manager.getRepository(CashRegister).save(register);
    });
  }

  // Una caja con un turno abierto no se desactiva: primero se cierra el turno. La caja se bloquea
  // igual que al abrir un turno (CashSessionService.open), así una apertura que llegue a la vez
  // espera y encuentra la caja ya desactivada.
  async deactivate(companyId: string, id: string): Promise<CashRegister> {
    return this.dataSource.transaction(async (manager) => {
      const register = await this.lockRegister(manager, companyId, id);

      const hasOpenSession = await manager.getRepository(CashSession).existsBy({
        cashRegisterId: register.id,
        status: CashSessionStatus.OPEN,
      });
      if (hasOpenSession) {
        throw new ConflictException('La caja tiene un turno abierto: ciérralo antes de desactivarla');
      }

      register.status = RecordStatus.INACTIVE;
      return manager.getRepository(CashRegister).save(register);
    });
  }

  async activate(companyId: string, id: string): Promise<CashRegister> {
    return this.dataSource.transaction(async (manager) => {
      const register = await this.lockRegister(manager, companyId, id);

      register.status = RecordStatus.ACTIVE;
      return manager.getRepository(CashRegister).save(register);
    });
  }

  // La caja bloqueada hasta que termine la transacción: renombrarla, desactivarla o reactivarla a la
  // vez esperan una a la otra, y cada una parte de lo que dejó la anterior (sin esto, un cambio de
  // nombre con el estado viejo volvería a activar una caja que acaban de desactivar). Se lee dos
  // veces: la primera comprueba la empresa a través de la tienda, y la segunda la bloquea, porque
  // Postgres no deja bloquear las filas de una consulta con uniones externas.
  private async lockRegister(
    manager: EntityManager,
    companyId: string,
    id: string,
  ): Promise<CashRegister> {
    const repo = manager.getRepository(CashRegister);
    const found = await repo.findOne({ where: { id, store: { companyId } } });
    if (!found) throw new NotFoundException(`Caja ${id} no encontrada`);

    const register = await repo.findOne({
      where: { id: found.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!register) throw new NotFoundException(`Caja ${id} no encontrada`);
    return register;
  }

  // Dos cambios a la vez con el mismo código pasan la comprobación de arriba; el índice único
  // (tienda, código) frena al segundo y aquí se traduce en el mismo mensaje.
  private mapWriteError(error: unknown): Error {
    return mapPostgresWriteError(error, {
      unique: 'Ya hay una caja con ese código en la tienda',
    });
  }
}
