import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { assertStoreAccess } from '../../common/access/store-access.js';
import { CashActor } from '../cash-session/cash-actor.js';
import { CashCodeVerdict, cashCodeException } from '../cash-session/cash-code.js';
import { CashSessionService } from '../cash-session/cash-session.service.js';
import { findIdempotentResource, runIdempotent } from '../idempotency/idempotency.js';
import { RegisterCashMovementInput } from './dto/register-cash-movement.input.js';
import { CashMovementReason } from './entities/cash-movement-reason.enum.js';
import { CashMovementType } from './entities/cash-movement-type.enum.js';
import { CashMovement } from './entities/cash-movement.entity.js';

// Motivos que solo tienen un sentido posible.
const CASH_OUT_ONLY_REASONS = [
  CashMovementReason.EXPENSE,
  CashMovementReason.WITHDRAWAL,
  CashMovementReason.REFUND,
];

// Un depósito siempre es efectivo que entra al cajón (nunca lo que sale hacia el banco).
const CASH_IN_ONLY_REASONS = [CashMovementReason.DEPOSIT];

// Lo que devuelve la transacción de register: el movimiento guardado, o el veredicto de un código
// rechazado, que se lanza como error después de confirmarla (ver CashSessionService.verifyMovementCode).
type MovementOutcome =
  | { kind: 'recorded'; movement: CashMovement }
  | { kind: 'rejected'; verdict: Exclude<CashCodeVerdict, CashCodeVerdict.OK> };

// Ingresos y egresos de efectivo de un turno que no son una venta. Se registran en un turno
// abierto, con el turno bloqueado (CashSessionService.lockOpen) para que un cierre no deje pasar
// uno a medias. Solo los registra el cajero asignado al turno, y con el código del día, que le da el
// administrador (ver cash-code.ts). La empresa de un movimiento es la de su turno. Nunca se editan
// ni se borran: se compensan con otro.
@Injectable()
export class CashMovementService {
  constructor(
    @InjectRepository(CashMovement)
    private readonly cashMovementRepository: Repository<CashMovement>,
    private readonly dataSource: DataSource,
    private readonly cashSessions: CashSessionService,
  ) {}

  // Los movimientos de un turno que quien pregunta puede ver, en el orden en que se hicieron. Un
  // turno que no puede ver se responde como si no existiera.
  async findAll(
    companyId: string,
    actor: CashActor,
    cashSessionId: string,
  ): Promise<CashMovement[]> {
    await this.cashSessions.findOne(companyId, actor, cashSessionId);
    return this.cashMovementRepository.find({
      where: { cashSessionId },
      order: { createdAt: 'ASC' },
    });
  }

  // Con `idempotencyKey`, repetir la misma petición (el cajero reintenta porque la respuesta se perdió)
  // devuelve el movimiento ya registrado en vez de registrarlo dos veces: un retiro duplicado dejaba el
  // arqueo descuadrado.
  async register(
    companyId: string,
    actor: CashActor,
    input: RegisterCashMovementInput,
    idempotencyKey?: string,
  ): Promise<CashMovement> {
    const amount = new Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('El monto del movimiento debe ser mayor que cero');
    }
    // La explicación es obligatoria de verdad: un texto solo con espacios no explica nada.
    const description = input.description?.trim();
    if (!description) {
      throw new BadRequestException('Explica por qué se mueve el efectivo');
    }
    this.assertReasonMatchesType(input.type, input.reason);

    const scope = {
      companyId,
      userId: actor.userId,
      operation: 'registerCashMovement',
      key: idempotencyKey,
      // Sin el código del día: si el administrador lo cambia entre el intento y el reintento, el
      // cajero escribe el nuevo y sigue siendo el mismo movimiento; y así el código no se guarda
      // (ni siquiera en huella) en la tabla de claves.
      input: { ...input, code: undefined },
      resourceType: 'cash_movement',
    };
    const loadMovement = (manager: EntityManager) => (id: string) =>
      manager.getRepository(CashMovement).findOneByOrFail({ id });

    const outcome = await this.dataSource.transaction(async (manager): Promise<MovementOutcome> => {
      // Un reintento de algo que ya quedó registrado se contesta antes de tocar nada: el turno pudo
      // cerrarse entre tanto y el código pudo cambiar, y eso no hace que el movimiento no exista.
      const done = await findIdempotentResource(manager, scope, loadMovement(manager));
      if (done) return { kind: 'recorded', movement: done };

      const session = await this.cashSessions.lockOpen(
        manager,
        companyId,
        input.cashSessionId,
        actor,
      );

      // Con el turno ya bloqueado se mira otra vez: un doble clic pone dos peticiones a la vez, la
      // segunda esperó aquí a que la primera confirmara, y ahora su movimiento ya existe (sin esto, un
      // retiro que dejó la gaveta justa fallaría por "no hay suficiente efectivo" en el reintento).
      const raced = await findIdempotentResource(manager, scope, loadMovement(manager));
      if (raced) return { kind: 'recorded', movement: raced };

      // Mover el efectivo de una gaveta es operar en esa tienda: hace falta seguir teniendo acceso
      // a ella. Va antes del código del día para no gastar un intento en algo que ya está negado.
      await assertStoreAccess(manager, actor.userId, session.cashRegister.storeId);

      // Un retiro o un gasto no puede sacar más efectivo del que de verdad hay en la gaveta en
      // este momento del turno. Se calcula con el turno ya bloqueado (lockOpen), así dos salidas
      // seguidas no se aprueban las dos contra el mismo saldo. Va antes del código del día por la
      // misma razón que el acceso a la tienda: no gastar un intento en un movimiento inválido.
      if (input.type === CashMovementType.CASH_OUT) {
        const expectedCash = await this.cashSessions.expectedCashOf(manager, session);
        if (amount.greaterThan(expectedCash)) {
          throw new BadRequestException('No hay suficiente efectivo en la caja para este movimiento');
        }
      }

      // El código del día del turno. Un intento equivocado se cuenta aunque el movimiento se
      // rechace, así que se guarda en esta transacción y el error se lanza después de confirmarla
      // (ver CashSessionService.verifyMovementCode). Va después de las demás comprobaciones para no
      // gastar uno de los 5 intentos en un movimiento que no era válido.
      const verdict = await this.cashSessions.verifyMovementCode(manager, session, input.code);
      if (verdict !== CashCodeVerdict.OK) return { kind: 'rejected', verdict };

      // La clave se reclama aquí, ya con el código aceptado (un código equivocado no debe dejar clave
      // reclamada: ese rechazo se confirma para contar el intento, ver más arriba).
      const movement = await runIdempotent(
        manager,
        scope,
        () => {
          const repo = manager.getRepository(CashMovement);
          return repo.save(
            repo.create({
              cashSessionId: session.id,
              type: input.type,
              reason: input.reason,
              amount,
              description,
              referenceNumber: input.referenceNumber?.trim() || null,
              createdBy: actor.userId,
            }),
          );
        },
        loadMovement(manager),
      );
      return { kind: 'recorded', movement };
    });

    if (outcome.kind === 'rejected') throw cashCodeException(outcome.verdict);
    return outcome.movement;
  }

  private assertReasonMatchesType(type: CashMovementType, reason: CashMovementReason): void {
    if (CASH_OUT_ONLY_REASONS.includes(reason) && type !== CashMovementType.CASH_OUT) {
      throw new BadRequestException('Un gasto, un retiro o una devolución tiene que ser una salida de efectivo');
    }
    if (CASH_IN_ONLY_REASONS.includes(reason) && type !== CashMovementType.CASH_IN) {
      throw new BadRequestException('Un depósito tiene que ser una entrada de efectivo');
    }
  }
}
