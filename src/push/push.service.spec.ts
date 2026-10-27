import { BadRequestException } from '@nestjs/common';
import webpush from 'web-push';
import { PushService, MAX_DEVICES_PER_USER, type PushPayload } from './push.service.js';

vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));

const COMPANY = 'company-1';
const USER = 'user-1';
const GOOD_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1';
const PAYLOAD: PushPayload = {
  title: 'Orden despachada',
  body: 'Lucía despachó la orden de compra OC-000001.',
  url: '/purchase-orders?order=po-1&company=company-1',
  tag: 'PURCHASE_ORDER:po-1',
};

const VAPID = {
  VAPID_PUBLIC_KEY: 'public-key',
  VAPID_PRIVATE_KEY: 'private-key',
  VAPID_SUBJECT: 'mailto:admin@example.com',
};

function createService({ env = VAPID, member = true }: { env?: Record<string, string>; member?: boolean } = {}) {
  const subscriptions = {
    find: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const memberships = { existsBy: vi.fn().mockResolvedValue(member) };
  const repo = {
    createQueryBuilder: vi.fn(() => {
      const builder = {
        delete: vi.fn(() => builder),
        where: vi.fn(() => builder),
        insert: vi.fn(() => builder),
        values: vi.fn(() => builder),
        orUpdate: vi.fn(() => builder),
        execute: vi.fn().mockResolvedValue(undefined),
      };
      return builder;
    }),
    find: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const manager = { getRepository: () => repo };
  const dataSource = { transaction: vi.fn(async (fn: (m: unknown) => unknown) => fn(manager)) };
  const config = { get: (key: string) => env[key] };
  const service = new PushService(config as never, subscriptions as never, memberships as never, dataSource as never);
  return { service, subscriptions, memberships, repo, dataSource };
}

beforeEach(() => {
  vi.mocked(webpush.sendNotification).mockReset();
});

describe('PushService.register', () => {
  it('refuses an endpoint that is not from a known push service', async () => {
    const { service, dataSource } = createService();

    await expect(
      service.register(COMPANY, USER, { endpoint: 'https://evil.example.com/x', p256dh: 'p', auth: 'a' }),
    ).rejects.toThrow(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('keeps at most five devices per person in the company, dropping the one unused the longest', async () => {
    const { service, repo } = createService();
    const devices = Array.from({ length: MAX_DEVICES_PER_USER + 1 }, (_, index) => ({ id: `device-${index}` }));
    repo.find.mockResolvedValue(devices);

    await service.register(COMPANY, USER, { endpoint: GOOD_ENDPOINT, p256dh: 'p', auth: 'a' });

    expect(repo.delete).toHaveBeenCalledWith(['device-5']);
  });
});

describe('PushService.dispatch', () => {
  it('sends the notice to every device of the member, with the payload as JSON', async () => {
    const { service, subscriptions } = createService();
    subscriptions.find.mockResolvedValue([
      { id: 'd1', endpoint: GOOD_ENDPOINT, p256dh: 'p1', auth: 'a1', failureCount: 0 },
      { id: 'd2', endpoint: 'https://web.push.apple.com/d2', p256dh: 'p2', auth: 'a2', failureCount: 0 },
    ]);
    vi.mocked(webpush.sendNotification).mockResolvedValue({} as never);

    await service.dispatch(COMPANY, USER, PAYLOAD);

    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: GOOD_ENDPOINT, keys: { p256dh: 'p1', auth: 'a1' } },
      JSON.stringify(PAYLOAD),
      expect.objectContaining({ urgency: 'normal' }),
    );
    expect(subscriptions.update).toHaveBeenCalledWith('d1', expect.objectContaining({ failureCount: 0 }));
  });

  it('removes a device the service says is gone (410)', async () => {
    const { service, subscriptions } = createService();
    subscriptions.find.mockResolvedValue([{ id: 'd1', endpoint: GOOD_ENDPOINT, p256dh: 'p', auth: 'a', failureCount: 0 }]);
    vi.mocked(webpush.sendNotification).mockRejectedValue({ statusCode: 410 });

    await service.dispatch(COMPANY, USER, PAYLOAD);

    expect(subscriptions.delete).toHaveBeenCalledWith('d1');
  });

  it('counts the rejections of a broken subscription and removes it at the limit', async () => {
    const { service, subscriptions } = createService();
    subscriptions.find.mockResolvedValue([{ id: 'd1', endpoint: GOOD_ENDPOINT, p256dh: 'p', auth: 'a', failureCount: 2 }]);
    vi.mocked(webpush.sendNotification).mockRejectedValue({ statusCode: 403 });

    await service.dispatch(COMPANY, USER, PAYLOAD);

    expect(subscriptions.delete).toHaveBeenCalledWith('d1');
  });

  it('keeps a device that failed for a reason that is not its fault (say, the service is down)', async () => {
    const { service, subscriptions } = createService();
    subscriptions.find.mockResolvedValue([{ id: 'd1', endpoint: GOOD_ENDPOINT, p256dh: 'p', auth: 'a', failureCount: 0 }]);
    vi.mocked(webpush.sendNotification).mockRejectedValue({ statusCode: 503 });

    await service.dispatch(COMPANY, USER, PAYLOAD);

    expect(subscriptions.delete).not.toHaveBeenCalled();
    expect(subscriptions.update).not.toHaveBeenCalled();
  });

  it('sends nothing to someone who no longer belongs to the company', async () => {
    const { service, subscriptions } = createService({ member: false });
    subscriptions.find.mockResolvedValue([{ id: 'd1', endpoint: GOOD_ENDPOINT, p256dh: 'p', auth: 'a', failureCount: 0 }]);

    await service.dispatch(COMPANY, USER, PAYLOAD);

    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('does nothing at all without the VAPID keys: the system notice is simply off', async () => {
    const { service, subscriptions } = createService({ env: {} });
    subscriptions.find.mockResolvedValue([{ id: 'd1', endpoint: GOOD_ENDPOINT, p256dh: 'p', auth: 'a', failureCount: 0 }]);

    await service.dispatch(COMPANY, USER, PAYLOAD);

    expect(webpush.sendNotification).not.toHaveBeenCalled();
    expect(service.vapidPublicKey()).toBeNull();
  });

  it('exposes the public key only when the notice is on', () => {
    expect(createService().service.vapidPublicKey()).toBe('public-key');
  });

  it('never throws, even when the lookup itself fails', async () => {
    const { service, memberships } = createService();
    memberships.existsBy.mockRejectedValue(new Error('db down'));

    await expect(service.dispatch(COMPANY, USER, PAYLOAD)).resolves.toBeUndefined();
  });
});
