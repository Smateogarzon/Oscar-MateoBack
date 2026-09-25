import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { PaymentMethod } from './entities/payment-method.entity.js';

// Todo se hace dentro de la empresa activa: un medio de pago de otra empresa se responde igual
// que uno que no existe. Solo lectura: los medios nacen con la empresa (default-payment-methods.ts)
// y lo que cambia es qué acepta cada tienda (StorePaymentMethodService).
@Injectable()
export class PaymentMethodService {
  constructor(
    @InjectRepository(PaymentMethod)
    private readonly paymentMethodRepository: Repository<PaymentMethod>,
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
}
