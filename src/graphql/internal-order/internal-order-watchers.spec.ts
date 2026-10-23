import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType as T } from '../notification/entities/notification-type.enum.js';
import { InternalOrderStatus as S } from './entities/internal-order-status.enum.js';
import type { InternalOrder } from './entities/internal-order.entity.js';
import { IncidentStatus } from '../incident/entities/incident-status.enum.js';
import { Incident } from '../incident/entities/incident.entity.js';
import { Location } from '../location/entities/location.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
import { notifyInternalOrder, settleCorrectionNotices, settleInternalOrderNotices, settleOrderIncidentNotices } from './internal-order-watchers.js';

const ORDER_ID = '11111111-1111-1111-1111-111111111111';

const manager = {} as never;
const notificationsMock = () => ({ markEntityRead: vi.fn().mockResolvedValue(0) });

// Lo que liquidó una orden en ese estado. `runnerId` es el corredor que ya la tomó, si lo hay.
async function settledAt(status: S, runnerId: string | null = null): Promise<T[]> {
  const notifications = notificationsMock();
  await settleInternalOrderNotices(manager, notifications as never, { id: ORDER_ID, status, runnerId } as InternalOrder);
  const call = notifications.markEntityRead.mock.calls[0];
  if (!call) return [];
  expect(call[1]).toBe(NotificationEntityType.INTERNAL_ORDER);
  expect(call[2]).toBe(ORDER_ID);
  return call[3] as T[];
}

describe('settleInternalOrderNotices', () => {
  // El bug: el aviso iba a TODA la bodega / a TODOS los corredores y solo salía de "Pendientes" para
  // quien lo abría. En cuanto uno daba el paso, a los demás les quedaba ahí para siempre.
  it('settles the "new order" notice as soon as the warehouse takes it', async () => {
    expect(await settledAt(S.NEW)).not.toContain(T.ORDER_REQUESTED);
    expect(await settledAt(S.PACKING)).toContain(T.ORDER_REQUESTED);
  });

  it('settles the "ready for runner" notice as soon as a runner picks it up', async () => {
    expect(await settledAt(S.READY_FOR_RUNNER)).not.toContain(T.ORDER_READY_FOR_RUNNER);
    expect(await settledAt(S.WAITING_FOR_RUNNER)).not.toContain(T.ORDER_READY_FOR_RUNNER);
    expect(await settledAt(S.IN_TRANSIT)).toContain(T.ORDER_READY_FOR_RUNNER);
  });

  // Tomarla no cambia el estado: sin esto, los demás corredores seguían con el aviso pendiente de una
  // orden que ya tiene dueño y que ni siquiera pueden ver.
  it('settles the offer for everyone else the moment one runner takes it', async () => {
    expect(await settledAt(S.READY_FOR_RUNNER, 'runner-1')).toContain(T.ORDER_READY_FOR_RUNNER);
    expect(await settledAt(S.WAITING_FOR_RUNNER, 'runner-1')).toContain(T.ORDER_READY_FOR_RUNNER);
  });

  // Y mientras no la tome nadie, la oferta sigue en pie.
  it('keeps the offer while nobody has taken it', async () => {
    expect(await settledAt(S.READY_FOR_RUNNER, null)).not.toContain(T.ORDER_READY_FOR_RUNNER);
  });

  it('settles the "pending payment" notice once the till charges it or hands it back', async () => {
    expect(await settledAt(S.PENDING_PAYMENT)).not.toContain(T.ORDER_PENDING_PAYMENT);
    expect(await settledAt(S.PAID)).toContain(T.ORDER_PENDING_PAYMENT);
    expect(await settledAt(S.RECEIVED_BY_SELLER)).toContain(T.ORDER_PENDING_PAYMENT);
  });

  it('settles the "delivered" notice once the receiver confirms', async () => {
    expect(await settledAt(S.DELIVERED_TO_STORE)).not.toContain(T.ORDER_DELIVERED);
    expect(await settledAt(S.RECEIVED_BY_SELLER)).toContain(T.ORDER_DELIVERED);
  });

  // Apurar y preguntar valen hasta que la mercancía sale del origen: la misma ventana que deja
  // mandarlos (ver `InternalOrderService.nudge`).
  it('settles "hurry" and "stock question" once the goods leave the source', async () => {
    expect(await settledAt(S.PACKING)).not.toContain(T.ORDER_HURRY);
    expect(await settledAt(S.PACKING)).not.toContain(T.ORDER_STOCK_QUESTION);
    expect(await settledAt(S.IN_TRANSIT)).toContain(T.ORDER_HURRY);
    expect(await settledAt(S.IN_TRANSIT)).toContain(T.ORDER_STOCK_QUESTION);
  });

  it('settles the runner notices once the runner stops answering for the order', async () => {
    expect(await settledAt(S.IN_TRANSIT)).not.toContain(T.ORDER_RUNNER_CALLED);
    expect(await settledAt(S.DELIVERED_TO_STORE)).not.toContain(T.ORDER_RUNNER_REPLIED);
    expect(await settledAt(S.RECEIVED_BY_SELLER)).toContain(T.ORDER_RUNNER_CALLED);
    expect(await settledAt(S.RECEIVED_BY_SELLER)).toContain(T.ORDER_RUNNER_REPLIED);
  });

  // Lo que se quedaba pendiente para siempre: el pedido cerrado o anulado.
  it('settles everything once the order reaches a final status', async () => {
    for (const status of [S.PAID, S.CANCELLED, S.RETURNED, S.TRANSFERRED, S.RESTOCKED, S.CLOSED_BY_CHANGE]) {
      const settled = await settledAt(status);
      expect(settled).toEqual(
        expect.arrayContaining([
          T.ORDER_REQUESTED,
          T.ORDER_READY_FOR_RUNNER,
          T.ORDER_DELIVERED,
          T.ORDER_PENDING_PAYMENT,
          T.ORDER_HURRY,
          T.ORDER_STOCK_QUESTION,
          T.ORDER_RUNNER_CALLED,
          T.ORDER_RUNNER_REPLIED,
        ]),
      );
    }
  });

  // El aviso de anulación nace con la orden ya anulada y pide lo único que queda por hacer: devolver
  // a su sitio lo que bodega había separado. No se liquida solo.
  it('never settles the cancellation notice: it waits to be opened', async () => {
    for (const status of Object.values(S)) {
      expect(await settledAt(status)).not.toContain(T.ORDER_CANCELLED);
    }
  });

  // La corrección no cambia el estado de la orden mientras va y viene: la cierra su propio paso.
  it('never settles the correction notice from a status change', async () => {
    for (const status of Object.values(S)) {
      expect(await settledAt(status)).not.toContain(T.ORDER_CORRECTION);
    }
  });

  it('touches nothing in a status where every notice is still alive', async () => {
    const notifications = notificationsMock();
    await settleInternalOrderNotices(manager, notifications as never, { id: ORDER_ID, status: S.NEW } as InternalOrder);

    // NEW deja vivos los de bodega, pero liquida los que ya no aplican: lo que importa es que no se
    // llame con una lista vacía.
    for (const call of notifications.markEntityRead.mock.calls) expect((call[3] as T[]).length).toBeGreaterThan(0);
  });
});

describe('settleCorrectionNotices', () => {
  it('settles the correction notice for the order', async () => {
    const notifications = notificationsMock();

    await settleCorrectionNotices(manager, notifications as never, ORDER_ID);

    expect(notifications.markEntityRead).toHaveBeenCalledWith(manager, NotificationEntityType.INTERNAL_ORDER, ORDER_ID, [
      T.ORDER_CORRECTION,
    ]);
  });
});

describe('settleOrderIncidentNotices', () => {
  // `count` responde cuántas novedades abiertas le quedan a la orden.
  const withOpen = (open: number) => {
    const notifications = { markEntityRead: vi.fn().mockResolvedValue(0) };
    const incidentRepo = { count: vi.fn().mockResolvedValue(open) };
    const manager = { getRepository: (entity: unknown) => (entity === Incident ? incidentRepo : null) } as never;
    return { manager, notifications, incidentRepo };
  };

  // El aviso de "novedad en un pedido" pide que alguien la atienda: mientras quede una abierta, sigue
  // pendiente. Es la misma regla que en las compras.
  it('leaves the notice pending while the order still has an open incident', async () => {
    const { manager, notifications } = withOpen(1);

    await settleOrderIncidentNotices(manager, notifications as never, ORDER_ID, ['item-1']);

    expect(notifications.markEntityRead).not.toHaveBeenCalled();
  });

  it('settles the notice once the last one is closed', async () => {
    const { manager, notifications } = withOpen(0);

    await settleOrderIncidentNotices(manager, notifications as never, ORDER_ID, ['item-1']);

    expect(notifications.markEntityRead).toHaveBeenCalledWith(manager, NotificationEntityType.INTERNAL_ORDER, ORDER_ID, [T.ORDER_INCIDENT]);
  });

  // Una novedad puede colgar de la orden entera o de una de sus líneas, y las líneas pueden ser de
  // una versión anterior (lo dañado sale del pedido): hay que contar las dos clases.
  it('counts both the ones on the order and the ones on its lines', async () => {
    const { manager, notifications, incidentRepo } = withOpen(0);

    await settleOrderIncidentNotices(manager, notifications as never, ORDER_ID, ['item-1', 'item-2']);

    const [{ where }] = incidentRepo.count.mock.calls[0] as [{ where: { entityType: string; status: unknown }[] }];
    expect(where).toHaveLength(2);
    expect(where.map((clause) => clause.entityType)).toEqual(['INTERNAL_ORDER', 'INTERNAL_ORDER_ITEM']);
  });

  it('still asks about the order when it has no lines left at all', async () => {
    const { manager, notifications, incidentRepo } = withOpen(0);

    await settleOrderIncidentNotices(manager, notifications as never, ORDER_ID, []);

    const [{ where }] = incidentRepo.count.mock.calls[0] as [{ where: unknown[] }];
    expect(where).toHaveLength(1);
    expect(notifications.markEntityRead).toHaveBeenCalled();
  });

  it('asks only about open and in-review ones: a closed one no longer holds the notice', async () => {
    const { manager, notifications, incidentRepo } = withOpen(0);

    await settleOrderIncidentNotices(manager, notifications as never, ORDER_ID, ['item-1']);

    const [{ where }] = incidentRepo.count.mock.calls[0] as [{ where: { status: { value: IncidentStatus[] } }[] }];
    expect(where[0].status.value).toEqual([IncidentStatus.OPEN, IncidentStatus.IN_REVIEW]);
  });
});

describe('a qué corredores se les ofrece una orden', () => {
  const SOURCE = 'bodega-1';
  const DESTINATION = 'tienda-1';

  // `assigned` dice qué sedes tiene cada corredor; solo los que tengan la de origen o la de destino
  // pueden tomar la orden (y son los únicos que la ven).
  function createWorld(runners: string[], assigned: Record<string, string[]>) {
    const locationAccessRepo = {
      find: vi.fn(async ({ where }: { where: { userId: { value: string[] }; locationId: { value: string[] } } }) =>
        (where.userId.value as string[])
          .filter((userId) => (assigned[userId] ?? []).some((location) => where.locationId.value.includes(location)))
          .map((userId) => ({ userId })),
      ),
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === UserLocationAccess
          ? locationAccessRepo
          : entity === UserCompanyRole
            ? { find: vi.fn().mockResolvedValue([]) }
            : entity === Location
              ? { findOneBy: vi.fn().mockResolvedValue({ id: DESTINATION, name: 'Tienda centro' }) }
              : null,
    } as never;
    const notifications = {
      findUserIdsWithPermission: vi.fn().mockResolvedValue(runners),
      notify: vi.fn().mockResolvedValue(null),
    };
    return { manager, notifications };
  }

  const offer = async (runners: string[], assigned: Record<string, string[]>) => {
    const { manager, notifications } = createWorld(runners, assigned);
    const order = { id: ORDER_ID, orderNumber: 'SO-1', sourceLocationId: SOURCE, destinationLocationId: DESTINATION, runnerId: null } as never;

    await notifyInternalOrder(manager, notifications as never, 'company-1', order, T.ORDER_READY_FOR_RUNNER, ['RUNNERS'], 'actor-1');

    return (notifications.notify.mock.calls[0]?.[1] as { recipientIds: string[] } | undefined)?.recipientIds ?? [];
  };

  // El bug: el aviso iba a TODOS los corredores de la empresa, también a los que no pueden abrir la
  // orden porque no trabajan en ninguna de sus dos sedes.
  it('deja fuera al corredor que no trabaja en ninguna de las dos sedes', async () => {
    const recipients = await offer(['cerca', 'lejos'], { cerca: [SOURCE], lejos: ['otra-sede'] });

    expect(recipients).toEqual(['cerca']);
  });

  it('le llega tanto al de la sede de origen como al de la de destino', async () => {
    const recipients = await offer(['en-bodega', 'en-tienda'], { 'en-bodega': [SOURCE], 'en-tienda': [DESTINATION] });

    expect(recipients).toEqual(expect.arrayContaining(['en-bodega', 'en-tienda']));
    expect(recipients).toHaveLength(2);
  });

  it('sin ningún corredor en esas sedes no se avisa a nadie', async () => {
    const { manager, notifications } = createWorld(['lejos'], { lejos: ['otra-sede'] });
    const order = { id: ORDER_ID, orderNumber: 'SO-1', sourceLocationId: SOURCE, destinationLocationId: DESTINATION, runnerId: null } as never;

    await notifyInternalOrder(manager, notifications as never, 'company-1', order, T.ORDER_READY_FOR_RUNNER, ['RUNNERS'], 'actor-1');

    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
