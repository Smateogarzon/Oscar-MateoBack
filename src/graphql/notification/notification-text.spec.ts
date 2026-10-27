import { NotificationChannel } from './entities/notification-channel.enum.js';
import { CHANNEL_OF_TYPE, NotificationType } from './entities/notification-type.enum.js';
import { buildNotificationText } from './notification-text.js';

const params = { actorName: 'Camila Rojas', reference: 'VTA-000125' };

// El prefijo del nombre dice de qué es el aviso, y de ahí sale su canal. PURCHASE_ORDER_ va antes
// que ORDER_ para que una orden de compra no termine en Pedidos.
const CHANNEL_OF_PREFIX: readonly (readonly [string, NotificationChannel])[] = [
  ['DISCOUNT_', NotificationChannel.DISCOUNTS],
  ['RETURN', NotificationChannel.RETURNS],
  ['INVENTORY_', NotificationChannel.INVENTORY],
  ['DISPLAY_', NotificationChannel.INVENTORY],
  ['PURCHASE_ORDER_', NotificationChannel.PURCHASING],
  ['ORDER_', NotificationChannel.ORDERS],
];

describe('CHANNEL_OF_TYPE', () => {
  // Un tipo nuevo con un prefijo que no esté aquí sale `undefined` y rompe esto a propósito: o se
  // llama como su familia, o hay que decir a qué canal pertenece.
  it('gives every type a channel, and the channel is the one its name says', () => {
    for (const type of Object.values(NotificationType)) {
      const expected = CHANNEL_OF_PREFIX.find(([prefix]) => type.startsWith(prefix))?.[1];
      expect(CHANNEL_OF_TYPE[type]).toBe(expected);
    }
  });
});

describe('buildNotificationText', () => {
  // Dos avisos no llevan quién lo hizo (cada uno tiene su prueba abajo): la existencia baja la ve el
  // sistema, no una persona, y la orden lista le dice al corredor qué recoger y dónde, no quién la alistó.
  const WITHOUT_ACTOR: readonly NotificationType[] = [NotificationType.INVENTORY_LOW_STOCK, NotificationType.ORDER_READY_FOR_RUNNER];
  const typesWithActor = Object.values(NotificationType).filter((type) => !WITHOUT_ACTOR.includes(type));

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

  it('tells the runner which order to pick up and where, without naming who prepared it', () => {
    const ready = buildNotificationText(NotificationType.ORDER_READY_FOR_RUNNER, { ...params, locationName: 'Bodega central' });

    expect(ready.title.length).toBeGreaterThan(0);
    expect(ready.message).toContain('VTA-000125');
    expect(ready.message).toContain('Bodega central');
    expect(ready.message).not.toContain('Camila Rojas');
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
