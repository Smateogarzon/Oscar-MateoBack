import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import webpush from 'web-push';
import { RecordStatus } from '../common/enums/record-status.enum.js';
import { UserCompanyRole } from '../graphql/user-company-role/entities/user-company-role.entity.js';
import { PushSubscription } from './entities/push-subscription.entity.js';
import { isAllowedPushEndpoint } from './push-endpoint.js';

// Cuántos dispositivos puede tener una persona en una empresa: el más viejo sin usar se borra.
export const MAX_DEVICES_PER_USER = 5;
// Cuántos rechazos seguidos aguanta un dispositivo antes de borrarlo.
const MAX_FAILURES = 3;
// Un aviso que no llegó en 12 horas ya no le sirve a nadie: el servicio de push lo descarta.
const TTL_SECONDS = 12 * 60 * 60;

/** Lo que se muestra en el sistema del dispositivo. Nunca lleva montos: lo ve quien esté cerca. */
export interface PushPayload {
  title: string;
  body: string;
  // A dónde lleva el toque (con la empresa, para que la app cambie a ella si hace falta).
  url: string;
  // Los avisos con el mismo tag se agrupan en vez de apilarse (una misma orden, un mismo descuento).
  tag: string;
}

export interface RegisterPushInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

/**
 * Los avisos del sistema (web push): registrar y quitar los dispositivos de cada persona, y mandar un
 * aviso a todos los suyos. Mandar nunca lanza: un aviso que falla no puede deshacer ni hacer fallar lo
 * que lo originó (igual que el tiempo real). Sin llaves VAPID configuradas, todo queda apagado.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly enabled: boolean;
  private readonly publicKey: string | null;

  constructor(
    config: ConfigService,
    @InjectRepository(PushSubscription)
    private readonly subscriptions: Repository<PushSubscription>,
    @InjectRepository(UserCompanyRole)
    private readonly memberships: Repository<UserCompanyRole>,
    private readonly dataSource: DataSource,
  ) {
    const publicKey = config.get<string>('VAPID_PUBLIC_KEY') || null;
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY') || null;
    const subject = config.get<string>('VAPID_SUBJECT') || null;
    this.publicKey = publicKey;
    this.enabled = false;
    if (publicKey && privateKey && subject) {
      try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        this.enabled = true;
      } catch (error) {
        this.logger.error(`Las llaves VAPID no son válidas; el aviso del sistema queda apagado: ${errorMessage(error)}`);
      }
    }
  }

  /** La llave pública con la que el navegador se suscribe; `null` si el aviso del sistema está apagado. */
  vapidPublicKey(): string | null {
    return this.enabled ? this.publicKey : null;
  }

  /**
   * Registra (o vuelve a confirmar) el dispositivo de quien pregunta en la empresa activa. Si el mismo
   * navegador ya estaba con otra persona (cuenta compartida), esa suscripción pasa a esta. Y si la
   * persona ya tiene cinco dispositivos, se borra el que lleva más tiempo sin usarse.
   */
  async register(companyId: string, userId: string, input: RegisterPushInput): Promise<void> {
    if (!isAllowedPushEndpoint(input.endpoint)) {
      throw new BadRequestException('La dirección de avisos no es de un servicio de push permitido');
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PushSubscription);
      await repo
        .createQueryBuilder()
        .delete()
        .where('endpoint = :endpoint AND "userId" <> :userId', { endpoint: input.endpoint, userId })
        .execute();

      const now = new Date();
      await repo
        .createQueryBuilder()
        .insert()
        .values({
          userId,
          companyId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent?.slice(0, 255) ?? null,
          failureCount: 0,
          lastSuccessAt: null,
          lastSeenAt: now,
        })
        .orUpdate(['p256dh', 'auth', 'userAgent', 'failureCount', 'lastSeenAt'], ['userId', 'companyId', 'endpoint'])
        .execute();

      const devices = await repo.find({
        where: { userId, companyId },
        order: { lastSeenAt: 'DESC' },
        select: { id: true },
      });
      const stale = devices.slice(MAX_DEVICES_PER_USER).map((device) => device.id);
      if (stale.length > 0) await repo.delete(stale);
    });
  }

  /** Quita un dispositivo de quien pregunta (al cerrar sesión o al desactivar los avisos). */
  async unregister(companyId: string, userId: string, endpoint: string): Promise<void> {
    await this.dataSource.transaction((manager) =>
      manager.getRepository(PushSubscription).delete({ companyId, userId, endpoint }),
    );
  }

  /**
   * Manda el aviso a todos los dispositivos de esa persona en esa empresa, si sigue siendo miembro
   * activo. Nunca lanza.
   */
  async dispatch(companyId: string, userId: string, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;
    try {
      const stillMember = await this.memberships.existsBy({
        userId,
        companyId,
        status: RecordStatus.ACTIVE,
        user: { status: RecordStatus.ACTIVE },
      });
      if (!stillMember) return;

      const devices = await this.subscriptions.find({ where: { userId, companyId } });
      await Promise.all(devices.map((device) => this.send(device, payload)));
    } catch (error) {
      this.logger.error(`No se pudo mandar el aviso del sistema: ${errorMessage(error)}`);
    }
  }

  // Un solo envío. Cada respuesta del servicio dice qué hacer con el dispositivo: 404 y 410 quiere decir
  // que el navegador ya no está suscrito (se borra); 400, 401 y 403 que la suscripción está rota (se
  // cuenta, y se borra al llegar al tope); el resto se anota y no se toca.
  private async send(device: PushSubscription, payload: PushPayload): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        JSON.stringify(payload),
        { TTL: TTL_SECONDS, urgency: 'normal' },
      );
      await this.subscriptions.update(device.id, { lastSuccessAt: new Date(), failureCount: 0 });
    } catch (error) {
      const status = statusCodeOf(error);
      if (status === 404 || status === 410) {
        await this.subscriptions.delete(device.id);
        return;
      }
      if (status === 400 || status === 401 || status === 403) {
        if (device.failureCount + 1 >= MAX_FAILURES) {
          await this.subscriptions.delete(device.id);
        } else {
          await this.subscriptions.update(device.id, { failureCount: device.failureCount + 1 });
        }
        return;
      }
      this.logger.warn(`El servicio de push respondió ${status ?? 'sin código'} para un dispositivo`);
    }
  }
}

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  const code = Number((error as { statusCode: unknown }).statusCode);
  return Number.isFinite(code) ? code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
