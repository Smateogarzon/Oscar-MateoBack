import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { assertActiveCompany } from '../../common/access/assert-active-company.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import {
  DEFAULT_CASH_REGISTER_CODE,
  defaultCashRegisterName,
} from '../cash-register/default-cash-register.js';
import { CashRegister } from '../cash-register/entities/cash-register.entity.js';
import { lockStoreRegisters } from '../cash-register/store-registers.js';
import { CashSessionStatus } from '../cash-session/entities/cash-session-status.enum.js';
import { CashSession } from '../cash-session/entities/cash-session.entity.js';
import { allowAllPaymentMethods } from '../payment-method/default-payment-methods.js';
import { CreateLocationInput } from './dto/create-location.input.js';
import { UpdateLocationInput } from './dto/update-location.input.js';
import { LocationType } from './entities/location-type.enum.js';
import { Location } from './entities/location.entity.js';

// Todo se hace dentro de la empresa activa: una sede de otra empresa se responde igual que
// una que no existe.
@Injectable()
export class LocationService {
  constructor(
    @InjectRepository(Location)
    private readonly locationRepository: Repository<Location>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(companyId: string, status?: RecordStatus): Promise<Location[]> {
    return this.locationRepository.find({
      where: { companyId, ...(status && { status }) },
    });
  }

  async findOne(companyId: string, id: string): Promise<Location> {
    const location = await this.locationRepository.findOneBy({ id, companyId });
    if (!location) throw new NotFoundException(`Sede ${id} no encontrada`);
    return location;
  }

  // Una tienda nace con su caja, con el nombre de la tienda (ver default-cash-register.ts), y
  // aceptando todos los medios de pago de la empresa (ver default-payment-methods.ts); las bodegas
  // no tienen nada de eso. Todo se guarda en la misma transacción: no queda una tienda a medias.
  async create(companyId: string, input: CreateLocationInput): Promise<Location> {
    assertActiveCompany(companyId, input.companyId);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Location);
      const location = await repo.save(repo.create({ ...input, companyId }));

      if (location.type === LocationType.STORE) {
        const registerRepo = manager.getRepository(CashRegister);
        await registerRepo.save(
          registerRepo.create({
            storeId: location.id,
            name: defaultCashRegisterName(location.name),
            code: DEFAULT_CASH_REGISTER_CODE,
          }),
        );
        await allowAllPaymentMethods(manager, companyId, location.id);
      }

      return location;
    });
  }

  // Al renombrar una tienda, la caja que nació con ella sigue el nombre nuevo — pero solo si nadie
  // se lo ha cambiado a mano: un nombre que alguien puso aparte no se pisa.
  //
  // Toda escritura sobre una sede lee la sede YA bloqueada, dentro de la transacción (lockLocation):
  // dos cambios a la vez esperan uno al otro y cada uno parte de lo que dejó el anterior. Sin esto,
  // guardar una sede leída antes pisaría lo que otro cambió mientras tanto (por ejemplo, un cambio de
  // nombre con el estado viejo volvería a activar una tienda que acaban de desactivar). Las cajas se
  // bloquean después de la sede, siempre en ese orden.
  async update(companyId: string, id: string, input: UpdateLocationInput): Promise<Location> {
    await this.findOne(companyId, id);

    return this.dataSource.transaction(async (manager) => {
      const location = await this.lockLocation(manager, companyId, id);
      const previousName = location.name;
      Object.assign(location, input);

      const saved = await manager.getRepository(Location).save(location);
      if (saved.type !== LocationType.STORE || saved.name === previousName) return saved;

      // Renombrar la caja también toca la caja: se bloquean las de la tienda para no pisar un cambio
      // que otro le esté haciendo (por ejemplo, desactivarla).
      const registers = await lockStoreRegisters(manager, saved.id);
      const register = registers.find((candidate) => candidate.code === DEFAULT_CASH_REGISTER_CODE);
      if (register?.name === defaultCashRegisterName(previousName)) {
        register.name = defaultCashRegisterName(saved.name);
        await manager.getRepository(CashRegister).save(register);
      }
      return saved;
    });
  }

  // Una tienda con un turno de caja abierto no se desactiva: primero se cierra con su arqueo. Es la
  // misma regla que ya protege a la caja (ver CashRegisterService.deactivate); sin ella, el efectivo
  // de la gaveta se quedaría sin cuadrar y sin nadie que pudiera cuadrarlo. Las cajas se bloquean
  // igual que al abrir un turno (CashSessionService.open) y con ellas bloqueadas se mira si hay un
  // turno abierto: una apertura que llegue a la vez espera, y una que llegue después ya ve la tienda
  // desactivada.
  async deactivate(companyId: string, id: string): Promise<Location> {
    await this.findOne(companyId, id);

    return this.dataSource.transaction(async (manager) => {
      const location = await this.lockLocation(manager, companyId, id);
      const registers = await lockStoreRegisters(manager, location.id);

      if (registers.length > 0) {
        const hasOpenShift = await manager.getRepository(CashSession).existsBy({
          cashRegisterId: In(registers.map((register) => register.id)),
          status: CashSessionStatus.OPEN,
        });
        if (hasOpenShift) {
          throw new ConflictException(
            `La tienda ${location.name} tiene un turno de caja abierto: ciérralo antes de desactivarla`,
          );
        }
      }

      location.status = RecordStatus.INACTIVE;
      return manager.getRepository(Location).save(location);
    });
  }

  // Vuelve a poner en servicio una sede desactivada. Desactivarla no toca sus cajas, así que la
  // tienda vuelve a operar con las mismas que tenía.
  async activate(companyId: string, id: string): Promise<Location> {
    await this.findOne(companyId, id);

    return this.dataSource.transaction(async (manager) => {
      const location = await this.lockLocation(manager, companyId, id);
      location.status = RecordStatus.ACTIVE;
      return manager.getRepository(Location).save(location);
    });
  }

  // La sede bloqueada hasta que termine la transacción (la misma fila que bloquea crear una caja en
  // la tienda: CashRegisterService.create).
  private async lockLocation(
    manager: EntityManager,
    companyId: string,
    id: string,
  ): Promise<Location> {
    const location = await manager.getRepository(Location).findOne({
      where: { id, companyId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!location) throw new NotFoundException(`Sede ${id} no encontrada`);
    return location;
  }
}
