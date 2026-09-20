import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Decimal } from 'decimal.js';
import { DataSource, In, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CashActor } from '../cash-session/cash-actor.js';
import { CashSessionService } from '../cash-session/cash-session.service.js';
import { DiscountRequestStatus } from '../discount-request/entities/discount-request-status.enum.js';
import { DiscountRequest } from '../discount-request/entities/discount-request.entity.js';
import { PaymentMethod } from '../payment-method/entities/payment-method.entity.js';
import { SaleItem } from '../sale/entities/sale-item.entity.js';
import { SaleStatus } from '../sale/entities/sale-status.enum.js';
import { Sale } from '../sale/entities/sale.entity.js';
import { SaleService } from '../sale/sale.service.js';
import { CompleteSaleInput } from './dto/complete-sale.input.js';
import { SalePayment } from './entities/sale-payment.entity.js';

// Cobrar una venta y dejarla completada. La empresa de un pago es la de su venta: todo se hace
// dentro de la empresa activa y una venta de otra empresa se responde como si no existiera.
@Injectable()
export class SalePaymentService {
  constructor(
    @InjectRepository(SalePayment)
    private readonly salePaymentRepository: Repository<SalePayment>,
    private readonly dataSource: DataSource,
    private readonly sales: SaleService,
    private readonly cashSessions: CashSessionService,
  ) {}

  // En el orden en que se registraron. La empresa se comprueba a través de la venta.
  async findAll(companyId: string, saleId: string): Promise<SalePayment[]> {
    await this.sales.findOne(companyId, saleId);
    return this.salePaymentRepository.find({ where: { saleId }, order: { createdAt: 'ASC' } });
  }

  // Completa una venta en borrador: guarda todos sus pagos, la deja COMPLETADA y la ata al turno
  // de caja en que se cobró. Todo o nada, en una transacción. Se exige que:
  //   - la venta tenga líneas y ninguna solicitud de descuento pendiente (una aprobada ya está
  //     aplicada en los totales)
  //   - el turno esté abierto, sea de una caja de la misma tienda y lo opere quien lo abrió o quien
  //     puede operar turnos ajenos (CashSessionService.lockOpen)
  //   - cada medio de pago sea activo y de la empresa, y traiga referencia si la exige
  //   - los pagos sumen EXACTAMENTE el total de la venta: el vuelto de un pago en efectivo de más
  //     lo maneja quien cobra y no se guarda
  // Primero se bloquea la venta y después el turno, siempre en ese orden, para no cruzar bloqueos.
  async complete(companyId: string, actor: CashActor, input: CompleteSaleInput): Promise<Sale> {
    const payments = input.payments.map((payment) => ({
      paymentMethodId: payment.paymentMethodId,
      amount: new Decimal(payment.amount),
      reference: payment.reference?.trim() || null,
    }));
    if (payments.length === 0) throw new BadRequestException('Indica al menos un pago');
    if (payments.some((payment) => payment.amount.lessThanOrEqualTo(0))) {
      throw new BadRequestException('Cada pago debe ser mayor que cero');
    }

    return this.dataSource.transaction(async (manager) => {
      const sale = await this.sales.lockDraft(manager, companyId, input.saleId);

      const hasPendingRequest = await manager.getRepository(DiscountRequest).existsBy({
        saleId: sale.id,
        status: DiscountRequestStatus.PENDING,
      });
      if (hasPendingRequest) {
        throw new ConflictException(
          'La venta tiene una solicitud de descuento pendiente: resuélvela o cancélala antes de cobrar',
        );
      }

      const hasLines = await manager.getRepository(SaleItem).existsBy({ saleId: sale.id });
      if (!hasLines) throw new BadRequestException('La venta no tiene líneas para cobrar');

      // Se cobra lo que suman las líneas hoy, no lo que haya quedado guardado.
      await this.sales.recalculate(manager, sale);
      if (sale.total.lessThanOrEqualTo(0)) {
        throw new BadRequestException('La venta no tiene nada que cobrar');
      }

      const session = await this.cashSessions.lockOpen(
        manager,
        companyId,
        input.cashSessionId,
        actor,
      );
      if (session.cashRegister.storeId !== sale.storeId) {
        throw new ConflictException('El turno es de una caja de otra tienda');
      }

      const methodIds = [...new Set(payments.map((payment) => payment.paymentMethodId))];
      const methods = await manager.getRepository(PaymentMethod).find({
        where: { id: In(methodIds), companyId, status: RecordStatus.ACTIVE },
      });
      const methodsById = new Map(methods.map((method) => [method.id, method]));
      for (const payment of payments) {
        const method = methodsById.get(payment.paymentMethodId);
        if (!method) {
          throw new NotFoundException(`Medio de pago ${payment.paymentMethodId} no encontrado`);
        }
        if (method.requiresReference && !payment.reference) {
          throw new BadRequestException(`El medio de pago ${method.name} exige una referencia`);
        }
      }

      const paid = payments.reduce((sum, payment) => sum.plus(payment.amount), new Decimal(0));
      if (!paid.equals(sale.total)) {
        throw new BadRequestException(
          `Los pagos suman ${paid.toFixed(2)} y la venta vale ${sale.total.toFixed(2)}: tienen que ser iguales`,
        );
      }

      const paymentRepo = manager.getRepository(SalePayment);
      await paymentRepo.save(
        payments.map((payment) =>
          paymentRepo.create({
            saleId: sale.id,
            paymentMethodId: payment.paymentMethodId,
            amount: payment.amount,
            reference: payment.reference,
            receivedBy: actor.userId,
          }),
        ),
      );

      sale.status = SaleStatus.COMPLETED;
      sale.completedAt = new Date();
      sale.cashSessionId = session.id;
      return manager.getRepository(Sale).save(sale);
    });
  }
}
