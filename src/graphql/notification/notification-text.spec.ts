import { NotificationChannel } from './entities/notification-channel.enum.js';
import { CHANNEL_OF_TYPE, NotificationType } from './entities/notification-type.enum.js';
import { buildNotificationText } from './notification-text.js';

const params = { actorName: 'Camila Rojas', reference: 'VTA-000125' };

describe('CHANNEL_OF_TYPE', () => {
  it('gives every type a channel, and the channel is the one its name says', () => {
    for (const type of Object.values(NotificationType)) {
      const expected = type.startsWith('DISCOUNT_')
        ? NotificationChannel.DISCOUNTS
        : NotificationChannel.RETURNS;
      expect(CHANNEL_OF_TYPE[type]).toBe(expected);
    }
  });
});

describe('buildNotificationText', () => {
  it.each(Object.values(NotificationType))('writes a title and a message for %s', (type) => {
    const { title, message } = buildNotificationText(type, params);

    expect(title.length).toBeGreaterThan(0);
    expect(title.length).toBeLessThanOrEqual(150);
    expect(message).toContain('Camila Rojas');
    expect(message).toContain('VTA-000125');
  });

  it('says who asked and for which sale', () => {
    expect(buildNotificationText(NotificationType.DISCOUNT_REQUESTED, params)).toEqual({
      title: 'Solicitud de descuento',
      message: 'Camila Rojas pidió un descuento en la venta VTA-000125.',
    });
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
