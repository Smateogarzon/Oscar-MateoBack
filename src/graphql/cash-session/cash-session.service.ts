import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, FindOptionsWhere, In, Repository } from 'typeorm';
import { type CompanyAccess, loadCompanyAccess } from '../../common/access/company-access.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { mapPostgresWriteError } from '../../common/utils/postgres-error.js';
import { CashMovement } from '../cash-movement/entities/cash-movement.entity.js';
import { CashRegister } from '../cash-register/entities/cash-register.entity.js';
import {
  clearDiscountRequestNotices,
  findDiscountRequestsOfSales,
} from '../discount-request/discount-request-cleanup.js';
import { DiscountRequestStatus } from '../discount-request/entities/discount-request-status.enum.js';
import { DiscountRequest } from '../discount-request/entities/discount-request.entity.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationService } from '../notification/notification.service.js';
import { SaleItem } from '../sale/entities/sale-item.entity.js';
import { SaleStatus } from '../sale/entities/sale-status.enum.js';
import { Sale } from '../sale/entities/sale.entity.js';
import { SalePayment } from '../sale-payment/entities/sale-payment.entity.js';
import { RefundPayment } from '../sale-return/entities/refund-payment.entity.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
import { User } from '../user/entities/user.entity.js';
import { CashActor } from './cash-actor.js';
import {
  CashCodeVerdict,
  generateCashCode,
  isCashCode,
  MAX_CASH_CODE_FAILURES,
} from './cash-code.js';
import { calculateSessionTotals } from './cash-session-totals.js';
import { CloseCashSessionInput } from './dto/close-cash-session.input.js';
import { OpenCashSessionInput } from './dto/open-cash-session.input.js';
import { CashSessionStatus } from './entities/cash-session-status.enum.js';
import { CashSession } from './entities/cash-session.entity.js';

// Quién puede ser el cajero de un turno: alguien cuyos roles le dan el permiso de cobrar. Es la única
// definición: la usa `open` para rechazar a quien no lo tiene y `findCashierCandidates` para no
// ofrecerlo, así la lista y la validación nunca se contradicen.
function canCollect(access: CompanyAccess | null): boolean {
  return access?.permissionCodes.includes(PermissionCode.CASH_REGISTER_PAYMENT) ?? false;
}

export type CashSessionSummary = ReturnType<typeof calculateSessionTotals> & {
  cashSessionId: string;
  openingAmount: Decimal;
  salesCount: number;
  // Ventas en borrador de este turno: las que se borran al cerrarlo (para avisarlo antes de cerrar)
  draftSalesCount: number;
};

// Cuántos turnos devuelve el historial de una vez: por defecto y como máximo (los más recientes).
export const DEFAULT_SESSIONS_LIMIT = 300;
export const MAX_SESSIONS_LIMIT = 1000;

// El código de Postgres de "no se pudo bloquear la fila" (SELECT ... FOR UPDATE NOWAIT)
const LOCK_NOT_AVAILABLE = '55P03';

// Un turno recién abierto y su código, que solo debe ver el administrador que lo abrió.
export interface OpenedCashSession {
  session: CashSession;
  code: string;
}

// La empresa de un turno es la de la tienda de su caja: todo se hace dentro de la empresa activa y
// un turno de otra empresa se responde como si no existiera.
// El administrador abre el turno de una caja para UN cajero y lo cierra; el cajero asignado es el
// único que cobra y mueve dinero en él. Cada cajero ve los turnos que se le asignaron; quien abre y
// cierra turnos, o tiene el permiso de ver todo (CashActor.canViewAll), ve los de todos.
// Toda operación que cambia un turno lo bloquea (`lockOpen`) hasta que termina su transacción: si
// además toca una venta, la venta se bloquea ANTES (ver SalePaymentService.complete), y así nunca
// se cruzan dos operaciones.
@Injectable()
export class CashSessionService {
  constructor(
    @InjectRepository(CashSession)
    private readonly cashSessionRepository: Repository<CashSession>,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationService,
  ) {}

  // Los más recientes primero, acotados: `limit` (300 por defecto, 1000 máximo) con `offset`. Un turno
  // abierto siempre está entre los más recientes.
  findAll(
    companyId: string,
    actor: CashActor,
    filters: { status?: CashSessionStatus; cashRegisterId?: string; limit?: number; offset?: number } = {},
  ): Promise<CashSession[]> {
    const { status, cashRegisterId } = filters;
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_SESSIONS_LIMIT, 1), MAX_SESSIONS_LIMIT);
    return this.cashSessionRepository.find({
      where: {
        ...this.visibleTo(companyId, actor),
        ...(status && { status }),
        ...(cashRegisterId && { cashRegisterId }),
      },
      order: { openedAt: 'DESC' },
      take: limit,
      skip: Math.max(filters.offset ?? 0, 0),
    });
  }

  async findOne(companyId: string, actor: CashActor, id: string): Promise<CashSession> {
    const session = await this.cashSessionRepository.findOne({
      where: { id, ...this.visibleTo(companyId, actor) },
    });
    if (!session) throw new NotFoundException(`Turno ${id} no encontrado`);
    return session;
  }

  // El turno abierto que se le asignó a quien pregunta, dentro de la empresa activa (null si no
  // tiene): el que tiene que usar para cobrar.
  findMyOpen(companyId: string, userId: string): Promise<CashSession | null> {
    return this.cashSessionRepository.findOne({
      where: {
        cashierId: userId,
        status: CashSessionStatus.OPEN,
        cashRegister: { store: { companyId } },
      },
    });
  }

  async summary(companyId: string, actor: CashActor, id: string): Promise<CashSessionSummary> {
    const session = await this.findOne(companyId, actor, id);
    return this.buildSummary(this.dataSource.manager, session);
  }

  // A quién se le puede dar el turno de una caja de esta tienda: usuarios activos, con acceso activo
  // a la tienda (Configuración → Personal por ubicación) y con un rol que les dé el permiso de cobrar.
  // Son las mismas condiciones con las que `open` acepta al cajero, así que quien aparece en esta
  // lista no será rechazado por permisos. (Que ya tenga otro turno abierto sí lo dice `open`: eso
  // cambia en cada momento y no es una cualidad de la persona.)
  async findCashierCandidates(companyId: string, storeId: string): Promise<User[]> {
    const store = await this.dataSource
      .getRepository(Location)
      .findOneBy({ id: storeId, companyId, type: LocationType.STORE });
    if (!store) throw new NotFoundException(`Tienda ${storeId} no encontrada`);

    const withAccess = await this.dataSource.getRepository(UserLocationAccess).find({
      where: { locationId: store.id, status: RecordStatus.ACTIVE, user: { status: RecordStatus.ACTIVE } },
      relations: { user: true },
    });

    const verdicts = await Promise.all(
      withAccess.map(async ({ user }) =>
        canCollect(await loadCompanyAccess(this.dataSource, user.id, companyId)) ? user : null,
      ),
    );
    return verdicts.filter((user): user is User => user !== null);
  }

  // Abre el turno de una caja activa, con el efectivo inicial, para UN cajero. El cajero tiene que
  // ser un miembro de la empresa con permiso para cobrar y acceso a la tienda de la caja, y no
  // puede tener otro turno abierto; la caja tampoco. Cada apertura crea un código nuevo de 6
  // dígitos (ver cash-code.ts), que se devuelve solo aquí y que el cajero le pide al administrador.
  // Con `idempotencyKey`, repetir la misma petición devuelve el turno ya abierto (y su código) en vez de
  // fallar con "la caja ya tiene un turno abierto".
  async open(
    companyId: string,
    adminId: string,
    input: OpenCashSessionInput,
    idempotencyKey?: string,
  ): Promise<OpenedCashSession> {
    const openingAmount = new Decimal(input.openingAmount ?? '0');

    // El cajero se comprueba antes de abrir la transacción: es una lectura que no necesita bloqueos.
    const cashierAccess = await loadCompanyAccess(this.dataSource, input.cashierId, companyId);
    if (!cashierAccess) throw new NotFoundException(`Cajero ${input.cashierId} no encontrado`);
    if (!canCollect(cashierAccess)) {
      throw new BadRequestException(
        'Ese usuario no tiene permiso para cobrar, así que no puede ser el cajero del turno',
      );
    }

    try {
      const session = await this.dataSource.transaction((manager) =>
        runIdempotent(
          manager,
          {
            companyId,
            userId: adminId,
            operation: 'openCashSession',
            key: idempotencyKey,
            input,
            resourceType: 'cash_session',
          },
          () => this.openInTransaction(manager, companyId, adminId, input, openingAmount),
          (id) => manager.getRepository(CashSession).findOneByOrFail({ id }),
        ),
      );
      return { session, code: session.movementCode };
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  private async openInTransaction(
    manager: EntityManager,
    companyId: string,
    adminId: string,
    input: OpenCashSessionInput,
    openingAmount: Decimal,
  ): Promise<CashSession> {
    const registerRepo = manager.getRepository(CashRegister);
    const found = await registerRepo.findOne({
      where: { id: input.cashRegisterId, store: { companyId } },
    });
    if (!found) throw new NotFoundException(`Caja ${input.cashRegisterId} no encontrada`);

    // La caja se bloquea y se vuelve a leer: dos aperturas a la vez esperan una a la otra, y
    // una desactivación de la caja, de la tienda o del acceso del cajero que llegue justo antes
    // se ve aquí (todas pasan por este mismo bloqueo, ver lockStoreRegisters).
    const register = await registerRepo.findOne({
      where: { id: found.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!register || register.status !== RecordStatus.ACTIVE) {
      throw new ConflictException('La caja está desactivada');
    }

    // La cuenta del cajero tiene que estar activa: tener el rol no basta, la cuenta pudo desactivarse
    // sin que se le quitaran los roles (y entonces el turno quedaría abierto para alguien que ni puede
    // entrar).
    const cashierActive = await manager
      .getRepository(User)
      .existsBy({ id: input.cashierId, status: RecordStatus.ACTIVE });
    if (!cashierActive) {
      throw new BadRequestException('Esa cuenta no está activa, así que no puede ser el cajero del turno');
    }

    // El cajero trabaja en la tienda de la caja (Configuración → Personal por ubicación). El
    // administrador que abre el turno no necesita ese acceso. Se comprueba con la caja ya
    // bloqueada: si otro administrador le está quitando el acceso, espera a que termine y ve el
    // resultado (quitarlo mientras se abre el turno dejaría a un cajero cobrando sin acceso).
    const cashierHasAccess = await manager.getRepository(UserLocationAccess).existsBy({
      userId: input.cashierId,
      locationId: register.storeId,
      status: RecordStatus.ACTIVE,
    });
    if (!cashierHasAccess) {
      throw new BadRequestException('El cajero no tiene acceso a la tienda de esta caja');
    }

    // La tienda también tiene que estar en servicio: una caja activa de una tienda desactivada
    // no sirve para vender, así que tampoco para abrir un turno.
    const store = await manager.getRepository(Location).findOneBy({ id: register.storeId });
    if (store?.status !== RecordStatus.ACTIVE) {
      throw new ConflictException(
        'La tienda de esta caja está desactivada: no se puede abrir un turno en ella',
      );
    }

    const repo = manager.getRepository(CashSession);
    if (await repo.existsBy({ cashRegisterId: register.id, status: CashSessionStatus.OPEN })) {
      throw new ConflictException('La caja ya tiene un turno abierto');
    }
    if (await repo.existsBy({ cashierId: input.cashierId, status: CashSessionStatus.OPEN })) {
      throw new ConflictException('Ese cajero ya tiene un turno abierto en otra caja');
    }

    const session = await repo.save(
      repo.create({
        cashRegisterId: register.id,
        openedBy: adminId,
        cashierId: input.cashierId,
        openingAmount,
        status: CashSessionStatus.OPEN,
        movementCode: generateCashCode(),
        movementCodeFailures: 0,
        openedAt: new Date(),
      }),
    );

    // Al cajero se le avisa en vivo (sin crear ningún aviso) para que su terminal vea el turno abierto
    // sin tener que recargar. Solo llega si la transacción se confirma.
    this.signalCashier(manager, companyId, session, adminId);
    return session;
  }

  // Avisa en vivo al cajero asignado (canal CASH) de que su turno se abrió o se cerró, para que su
  // pantalla se ponga al día sola. Quien hizo el cambio ya se refresca con su propia operación.
  private signalCashier(
    manager: EntityManager,
    companyId: string,
    session: CashSession,
    actorId: string,
  ): void {
    this.notifications.signalChange(manager, {
      companyId,
      channel: NotificationChannel.CASH,
      entityType: NotificationEntityType.CASH_SESSION,
      entityId: session.id,
      recipientIds: [session.cashierId],
      exceptUserId: actorId,
    });
  }

  // Cierra el turno con el efectivo contado. El servidor calcula lo esperado (y con el turno
  // bloqueado, así ningún cobro ni movimiento entra a medias) y la diferencia; si hay diferencia,
  // hacen falta las notas. Lo cierra el administrador, cualquiera, no solo quien lo abrió. Las
  // ventas en borrador que queden sin cobrar se borran: solo se cobran en su turno, y este ya no
  // las puede recibir. Con `idempotencyKey`, repetir la petición devuelve el turno ya cerrado en vez de
  // fallar con "el turno ya está cerrado".
  //
  // Orden de bloqueos: primero las ventas en borrador del turno y después el turno, igual que todo cobro
  // (venta → turno). Las ventas se bloquean SIN esperar: si el cajero está cobrando una en ese momento
  // (o agregándole una línea), el cierre se rechaza con un aviso y se reintenta en unos segundos, en
  // vez de esperar y cruzarse con el cobro (deadlock) o dejar que el cobro falle a medias.
  async close(
    companyId: string,
    actor: CashActor,
    input: CloseCashSessionInput,
    idempotencyKey?: string,
  ): Promise<CashSession> {
    const counted = new Decimal(input.countedAmount);
    const notes = input.notes?.trim() || null;

    return this.dataSource.transaction((manager) =>
      runIdempotent(
        manager,
        {
          companyId,
          userId: actor.userId,
          operation: 'closeCashSession',
          key: idempotencyKey,
          input,
          resourceType: 'cash_session',
        },
        async () => {
          const drafts = await this.lockDraftsBeforeSession(manager, companyId, input.cashSessionId);
          const session = await this.lockOpenForClosing(manager, companyId, input.cashSessionId);

          const { expectedCash } = await this.buildSummary(manager, session);
          const difference = counted.minus(expectedCash);
          if (!difference.isZero() && !notes) {
            throw new BadRequestException(
              `Lo contado (${counted.toFixed(2)}) no coincide con lo esperado (${expectedCash.toFixed(2)}): explica la diferencia en las notas`,
            );
          }

          session.status = CashSessionStatus.CLOSED;
          session.closedBy = actor.userId;
          session.closedAt = new Date();
          session.expectedAmount = expectedCash;
          session.countedAmount = counted;
          session.differenceAmount = difference;
          session.notes = notes;
          await this.discardDraftSales(manager, companyId, drafts, actor.userId);
          const saved = await manager.getRepository(CashSession).save(session);

          // La terminal del cajero se entera del cierre (si no, seguiría armando ventas en un turno
          // que ya no las recibe).
          this.signalCashier(manager, companyId, saved, actor.userId);
          return saved;
        },
        (id) => manager.getRepository(CashSession).findOneByOrFail({ id }),
      ),
    );
  }

  // Bloquea, sin esperar, las ventas en borrador del turno (en orden de id, para no cruzarse con otro
  // cierre) y las devuelve. Antes comprueba que el turno sea de la empresa activa: un turno ajeno se
  // responde como si no existiera y sus ventas ni se tocan. Si alguna está en uso, rechaza.
  private async lockDraftsBeforeSession(
    manager: EntityManager,
    companyId: string,
    cashSessionId: string,
  ): Promise<Sale[]> {
    const belongsToCompany = await manager
      .getRepository(CashSession)
      .existsBy({ id: cashSessionId, cashRegister: { store: { companyId } } });
    if (!belongsToCompany) throw new NotFoundException(`Turno ${cashSessionId} no encontrado`);

    try {
      return await manager.getRepository(Sale).find({
        where: { cashSessionId, status: SaleStatus.DRAFT },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write', onLocked: 'nowait' },
      });
    } catch (error) {
      const code = (error as { driverError?: { code?: string } }).driverError?.code;
      if (code === LOCK_NOT_AVAILABLE) {
        throw new ConflictException(
          'El cajero está usando una venta de este turno en este momento (cobrando o editando): espera unos segundos e inténtalo de nuevo',
        );
      }
      throw error;
    }
  }

  // Borra del todo (no las anula: no dejan rastro ni en el histórico, y como los borradores no tienen
  // número, tampoco dejan huecos en la numeración) las ventas que quedaron en borrador en este turno.
  // Un borrador no movió dinero ni inventario, así que no hay nada que deshacer; solo se van con él sus
  // líneas y sus solicitudes de descuento (avisando a los administradores que las tenían pendientes).
  // Las ventas llegan ya bloqueadas (lockDraftsBeforeSession).
  private async discardDraftSales(
    manager: EntityManager,
    companyId: string,
    drafts: Sale[],
    actorId: string,
  ): Promise<void> {
    if (drafts.length === 0) return;

    const saleIds = drafts.map((sale) => sale.id);
    const requests = await findDiscountRequestsOfSales(manager, saleIds, [
      DiscountRequestStatus.PENDING,
      DiscountRequestStatus.APPROVED,
    ]);
    await clearDiscountRequestNotices(manager, this.notifications, companyId, requests, actorId);

    // Las líneas primero: las filas de descuento por línea (discount_request_items) se van con
    // ellas en cascada, y así ya no queda nada que impida borrar las solicitudes.
    await manager.getRepository(SaleItem).delete({ saleId: In(saleIds) });
    await manager.getRepository(DiscountRequest).delete({ saleId: In(saleIds) });
    await manager.getRepository(Sale).delete({ id: In(saleIds) });
  }

  // El código del turno, para el administrador que lo tiene que dar al cajero. Solo de un turno
  // abierto: al cerrarse, el código deja de servir.
  async getMovementCode(companyId: string, actor: CashActor, id: string): Promise<string> {
    this.assertCanManageShifts(actor);

    const session = await this.findOne(companyId, actor, id);
    if (session.status !== CashSessionStatus.OPEN) {
      throw new ConflictException('El turno ya está cerrado: su código ya no sirve');
    }
    return session.movementCode;
  }

  // Cambia el código de un turno abierto: el anterior deja de servir y se borra la cuenta de códigos
  // equivocados, así que también sirve para desbloquear los movimientos.
  async regenerateMovementCode(companyId: string, actor: CashActor, id: string): Promise<string> {
    this.assertCanManageShifts(actor);

    return this.dataSource.transaction(async (manager) => {
      const session = await this.lockOpenForClosing(manager, companyId, id);

      session.movementCode = generateCashCode();
      session.movementCodeFailures = 0;
      await manager.getRepository(CashSession).save(session);
      return session.movementCode;
    });
  }

  // Comprueba el código que escribió el cajero contra el del turno, que tiene que venir bloqueado
  // (lockOpen). NO lanza el error de un código rechazado: devuelve el veredicto. Un intento
  // equivocado se cuenta y se guarda con la transacción de quien llama, y esa transacción se
  // confirma aunque la operación se rechace; el error se lanza después (cashCodeException). Si el
  // error deshiciera la transacción, el contador volvería atrás y el bloqueo no funcionaría.
  async verifyMovementCode(
    manager: EntityManager,
    session: CashSession,
    given: string,
  ): Promise<CashCodeVerdict> {
    if (session.movementCodeFailures >= MAX_CASH_CODE_FAILURES) return CashCodeVerdict.LOCKED;

    const repo = manager.getRepository(CashSession);
    if (isCashCode(given, session.movementCode)) {
      // Los errores cuentan "seguidos": un acierto empieza la cuenta de nuevo.
      if (session.movementCodeFailures > 0) {
        session.movementCodeFailures = 0;
        await repo.save(session);
      }
      return CashCodeVerdict.OK;
    }

    session.movementCodeFailures += 1;
    await repo.save(session);
    return CashCodeVerdict.WRONG;
  }

  // Trae el turno bloqueado hasta que la transacción termine, para que cobre o mueva dinero SU
  // cajero: el asignado, nadie más (un solo cajero por caja), tampoco el administrador que lo abrió:
  // si tiene que cobrar, se asigna como cajero. Exige que el turno siga abierto. Devuelve el turno con
  // su caja (`cashRegister`) cargada. Es pública porque SaleService, CashMovementService,
  // SalePaymentService y SaleReturnService la usan: todo lo que cambia un turno ocurre con el turno
  // bloqueado, y por eso un cierre nunca deja pasar un cobro a medias.
  lockOpen(
    manager: EntityManager,
    companyId: string,
    id: string,
    actor: CashActor,
  ): Promise<CashSession> {
    return this.lock(manager, companyId, id, actor.userId);
  }

  // Lo mismo, pero para el administrador que cierra el turno o cambia su código: cualquier turno
  // abierto de la empresa, sea quien sea su cajero.
  lockOpenForClosing(manager: EntityManager, companyId: string, id: string): Promise<CashSession> {
    return this.lock(manager, companyId, id, null);
  }

  private async lock(
    manager: EntityManager,
    companyId: string,
    id: string,
    onlyCashierId: string | null,
  ): Promise<CashSession> {
    const repo = manager.getRepository(CashSession);

    // La empresa se comprueba a través de la caja y su tienda. El bloqueo va en otra lectura:
    // Postgres no deja bloquear las filas de una consulta con uniones externas.
    const found = await repo.findOne({
      where: { id, cashRegister: { store: { companyId } } },
      relations: { cashRegister: true },
    });
    if (!found) throw new NotFoundException(`Turno ${id} no encontrado`);
    if (onlyCashierId !== null && found.cashierId !== onlyCashierId) {
      throw new ForbiddenException(
        'Solo el cajero asignado a este turno puede cobrar y mover dinero en él',
      );
    }

    const session = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!session) throw new NotFoundException(`Turno ${id} no encontrado`);
    if (session.status !== CashSessionStatus.OPEN) {
      throw new ConflictException('El turno ya está cerrado');
    }

    session.cashRegister = found.cashRegister;
    return session;
  }

  private assertCanManageShifts(actor: CashActor): void {
    if (!actor.canManageShifts) {
      throw new ForbiddenException('Solo quien abre y cierra turnos ve y cambia el código del día');
    }
  }

  // Lo que cada uno puede ver, siempre dentro de la empresa activa: el cajero, los turnos que se le
  // asignaron; quien abre y cierra turnos o tiene el permiso de ver todo, todos.
  private visibleTo(companyId: string, actor: CashActor): FindOptionsWhere<CashSession> {
    return {
      cashRegister: { store: { companyId } },
      ...(!actor.canViewAll && { cashierId: actor.userId }),
    };
  }

  // El efectivo que debería haber en la gaveta en este momento del turno (antes de un movimiento
  // nuevo): apertura + ventas en efectivo + ingresos − egresos − reembolsos en efectivo. Pública
  // porque CashMovementService la usa para no dejar sacar más de lo que hay; se llama con el
  // turno ya bloqueado (lockOpen), así dos retiros seguidos no se aprueban contra el mismo saldo.
  async expectedCashOf(manager: EntityManager, session: CashSession): Promise<Decimal> {
    return (await this.buildSummary(manager, session)).expectedCash;
  }

  private async buildSummary(
    manager: EntityManager,
    session: CashSession,
  ): Promise<CashSessionSummary> {
    // Los pagos de las ventas cobradas en este turno, sus movimientos manuales y los reembolsos de
    // devoluciones que se entregaron desde él
    const payments = await manager.getRepository(SalePayment).find({
      where: { sale: { cashSessionId: session.id } },
      relations: { paymentMethod: true },
    });
    const movements = await manager
      .getRepository(CashMovement)
      .find({ where: { cashSessionId: session.id } });
    const refunds = await manager.getRepository(RefundPayment).find({
      where: { cashSessionId: session.id },
      relations: { paymentMethod: true },
    });
    // Los borradores de un turno cerrado ya se borraron: son cero
    const draftSalesCount = await manager
      .getRepository(Sale)
      .countBy({ cashSessionId: session.id, status: SaleStatus.DRAFT });

    return {
      cashSessionId: session.id,
      openingAmount: session.openingAmount,
      salesCount: new Set(payments.map((payment) => payment.saleId)).size,
      draftSalesCount,
      ...calculateSessionTotals(
        session.openingAmount,
        payments.map((payment) => ({ amount: payment.amount, type: payment.paymentMethod.type })),
        movements,
        refunds.map((refund) => ({ amount: refund.amount, type: refund.paymentMethod.type })),
      ),
    };
  }

  // Dos aperturas a la vez de la misma caja (o del mismo cajero) pasan las comprobaciones de
  // arriba si no se bloquearon a tiempo; los índices únicos parciales frenan a la segunda.
  private mapWriteError(error: unknown): Error {
    return mapPostgresWriteError(error, {
      unique: 'La caja o el cajero ya tiene un turno abierto',
    });
  }
}
