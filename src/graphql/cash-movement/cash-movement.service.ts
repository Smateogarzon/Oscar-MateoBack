import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, Repository } from 'typeorm';
import { assertStoreAccess } from '../../common/access/store-access.js';
import { CashActor } from '../cash-session/cash-actor.js';
import { CashCodeVerdict, cashCodeException } from '../cash-session/cash-code.js';
import { CashSessionService } from '../cash-session/cash-session.service.js';
import { RegisterCashMovementInput } from './dto/register-cash-movement.input.js';
import { CashMovementReason } from './entities/cash-movement-reason.enum.js';
import { CashMovementType } from './entities/cash-movement-type.enum.js';
import { CashMovement } from './entities/cash-movement.entity.js';

// Motivos que solo tienen un sentido posible. DEPOSIT es el único que puede ir en cualquiera de
// los dos: un depósito puede llevar efectivo al banco o al cajón.
const CASH_OUT_ONLY_REASONS = [
  CashMovementReason.EXPENSE,
  CashMovementReason.WITHDRAWAL,
  CashMovementReason.REFUND,
];

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

  async register(
    companyId: string,
    actor: CashActor,
    input: RegisterCashMovementInput,
  ): Promise<CashMovement> {
    const amount = new Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('El monto del movimiento debe ser mayor que cero');
    }
    this.assertReasonMatchesType(input.type, input.reason);

    const outcome = await this.dataSource.transaction(async (manager): Promise<MovementOutcome> => {
      const session = await this.cashSessions.lockOpen(
        manager,
        companyId,
        input.cashSessionId,
        actor,
      );

      // Mover el efectivo de una gaveta es operar en esa tienda: hace falta seguir teniendo acceso
      // a ella. Va antes del código del día para no gastar un intento en algo que ya está negado.
      await assertStoreAccess(manager, actor.userId, session.cashRegister.storeId);

      // El código del día del turno. Un intento equivocado se cuenta aunque el movimiento se
      // rechace, así que se guarda en esta transacción y el error se lanza después de confirmarla
      // (ver CashSessionService.verifyMovementCode). Va después de las demás comprobaciones para no
      // gastar uno de los 5 intentos en un movimiento que no era válido.
      const verdict = await this.cashSessions.verifyMovementCode(manager, session, input.code);
      if (verdict !== CashCodeVerdict.OK) return { kind: 'rejected', verdict };

      const repo = manager.getRepository(CashMovement);
      const movement = await repo.save(
        repo.create({
          cashSessionId: session.id,
          type: input.type,
          reason: input.reason,
          amount,
          description: input.description?.trim() || null,
          referenceNumber: input.referenceNumber?.trim() || null,
          createdBy: actor.userId,
        }),
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
  }
}
