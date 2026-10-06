import { NotificationChannel } from './entities/notification-channel.enum.js';
import { CHANNEL_OF_TYPE, NotificationType } from './entities/notification-type.enum.js';
import { buildNotificationText } from './notification-text.js';

const params = { actorName: 'Camila Rojas', reference: 'VTA-000125' };

describe('CHANNEL_OF_TYPE', () => {
  it('gives every type a channel, and the channel is the one its name says', () => {
    for (const type of Object.values(NotificationType)) {
      const expected = type.startsWith('DISCOUNT_')
        ? NotificationChannel.DISCOUNTS
        : type.startsWith('INVENTORY_')
          ? NotificationChannel.INVENTORY
          : NotificationChannel.RETURNS;
      expect(CHANNEL_OF_TYPE[type]).toBe(expected);
    }
  });
});

describe('buildNotificationText', () => {
  // La existencia baja es un aviso del sistema, no de una persona: no lleva quién lo hizo (ver abajo).
  const typesWithActor = Object.values(NotificationType).filter((type) => type !== NotificationType.INVENTORY_LOW_STOCK);

  it.each(typesWithActor)('writes a title and a message for %s', (type) => {
    const { title, message } = buildNotificationText(type, params);

    expect(title.length).toBeGreaterThan(0);
    expect(title.length).toBeLessThanOrEqual(150);
    expect(message).toContain('Camila Rojas');
    expect(message).toContain('VTA-000125');
  });

  it('says which product ran low, where and how much is left, without an actor', () => {
    const low = buildNotificationText(NotificationType.INVENTORY_LOW_STOCK, {
      ...params,
      reference: 'Air Force 1 (AF1-BL-40)',
      quantity: '2',
      minStock: '3',
      locationName: 'Bodega central',
    });
    expect(low.title).toBe('Existencia baja');
    expect(low.message).toContain('Air Force 1');
    expect(low.message).toContain('Bodega central');
    expect(low.message).toContain('quedaron 2 unidades (mínimo 3)');
    expect(low.message).not.toContain('Camila Rojas');

    const out = buildNotificationText(NotificationType.INVENTORY_LOW_STOCK, { ...params, quantity: '0', outOfStock: true });
    expect(out.message).toContain('se agotó');
  });

  it('says who asked and for which sale', () => {
    expect(buildNotificationText(NotificationType.DISCOUNT_REQUESTED, params)).toEqual({
      title: 'Solicitud de descuento',
      message: 'Camila Rojas pidió un descuento en la venta VTA-000125.',
    });
  });

  it('talks about "una venta en curso" when the sale is a draft and has no number yet', () => {
    const draft = { actorName: 'Camila Rojas', reference: null };

    expect(buildNotificationText(NotificationType.DISCOUNT_REQUESTED, draft).message).toBe(
      'Camila Rojas pidió un descuento en una venta en curso.',
    );
    expect(buildNotificationText(NotificationType.DISCOUNT_APPROVED, draft).message).toBe(
      'Camila Rojas aprobó el descuento de una venta en curso.',
    );
  });

  it('tells the cashier that an approved return can already be paid out or exchanged', () => {
    const { message } = buildNotificationText(NotificationType.RETURN_APPROVED, {
      actorName: 'Admin',
      reference: 'DEV-00018',
    });

    expect(message).toBe(
      'Admin aprobó la devolución DEV-00018. Ya puedes entregar el dinero o cobrar el cambio.',
    );
  });

  it.each([
    NotificationType.DISCOUNT_REJECTED,
    NotificationType.DISCOUNT_CANCELLED,
    NotificationType.RETURN_REJECTED,
    NotificationType.RETURN_CANCELLED,
  ])('adds the note to %s', (type) => {
    const { message } = buildNotificationText(type, { ...params, notes: '  Muy alto  ' });

    expect(message.endsWith(' Nota: Muy alto')).toBe(true);
  });

  it.each([
    NotificationType.DISCOUNT_REQUESTED,
    NotificationType.DISCOUNT_APPROVED,
    NotificationType.DISCOUNT_EDITED,
    NotificationType.RETURN_REQUESTED,
    NotificationType.RETURN_EDITED,
    NotificationType.RETURN_APPROVED,
  ])('does not add a note to %s', (type) => {
    const { message } = buildNotificationText(type, { ...params, notes: 'Muy alto' });

    expect(message).not.toContain('Nota:');
  });

  it('ignores an empty note', () => {
    const { message } = buildNotificationText(NotificationType.DISCOUNT_REJECTED, {
      ...params,
      notes: '   ',
    });

    expect(message).not.toContain('Nota:');
  });

  it('never goes over the 500 characters the message column holds', () => {
    const { message } = buildNotificationText(NotificationType.DISCOUNT_REJECTED, {
      ...params,
      notes: 'x'.repeat(2000),
    });

    expect(message).toHaveLength(500);
  });
});
