import { Column, Entity, Index } from 'typeorm';
import { ImmutableEntity } from '../../../common/entities/immutable.entity.js';

// Una operación que ya se hizo, identificada por la clave que mandó el cliente (cabecera
// `x-idempotency-key`, una por acción del usuario: "cobrar esta venta", "registrar este retiro"). Si la
// misma clave llega otra vez —el usuario reintenta porque la respuesta se perdió, hace doble clic o
// el navegador repite la petición— el servidor no vuelve a hacer la operación: devuelve lo que ya se
// creó. La fila se escribe en la MISMA transacción que la operación (ver idempotency.ts): existe si y
// solo si la operación quedó confirmada. No tiene llaves foráneas a propósito: es un registro de
// control, y una llave foránea la ataría al bloqueo de las filas de usuarios y empresas.
@Entity('idempotency_keys')
@Index(['companyId', 'userId', 'operation', 'key'], { unique: true })
@Index(['createdAt'])
export class IdempotencyKey extends ImmutableEntity {
  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  userId: string;

  // Nombre de la operación (`completeSale`, `registerCashMovement`…): la misma clave en dos
  // operaciones distintas no se confunde.
  @Column({ type: 'varchar', length: 60 })
  operation: string;

  @Column({ type: 'varchar', length: 100 })
  key: string;

  // Huella de lo que pidió el cliente. Si la misma clave llega con otros datos no es un reintento:
  // se rechaza en vez de devolver algo que no corresponde.
  @Column({ type: 'varchar', length: 64 })
  fingerprint: string;

  // Qué se creó o cambió con esa operación, para devolverlo de nuevo en un reintento
  @Column({ type: 'varchar', length: 40, nullable: true })
  resourceType: string | null;

  @Column({ type: 'uuid', nullable: true })
  resourceId: string | null;
}
