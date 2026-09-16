import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { RecordStatus } from '../enums/record-status.enum.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

function createGuard(storedUser: unknown, skipsPasswordCheck = false) {
  const jwtService = { verify: vi.fn(() => ({ sub: 'user-1', email: 'ana@example.com' })) };
  const reflector = { getAllAndOverride: vi.fn(() => skipsPasswordCheck) };
  const dataSource = {
    getRepository: () => ({ findOneBy: vi.fn(async () => storedUser) }),
  };

  return {
    guard: new JwtAuthGuard(jwtService as never, reflector as never, dataSource as never),
    jwtService,
  };
}

function contextWith(authorization?: string) {
  const req = { headers: { authorization }, user: undefined };
  vi.spyOn(GqlExecutionContext, 'create').mockReturnValue({
    getContext: () => ({ req }),
  } as unknown as GqlExecutionContext);
  return { req, context: {} as never };
}

const activeUser = {
  id: 'user-1',
  status: RecordStatus.ACTIVE,
  mustChangePassword: false,
};

describe('JwtAuthGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a request without a Bearer token', async () => {
    const { guard } = createGuard(activeUser);
    const { context } = contextWith(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a valid token whose user was deactivated', async () => {
    const { guard } = createGuard({ ...activeUser, status: RecordStatus.INACTIVE });
    const { context } = contextWith('Bearer token');

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('blocks a user with a pending password change', async () => {
    const { guard } = createGuard({ ...activeUser, mustChangePassword: true });
    const { context } = contextWith('Bearer token');

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('lets a pending password change through on exempt operations', async () => {
    const { guard } = createGuard({ ...activeUser, mustChangePassword: true }, true);
    const { context } = contextWith('Bearer token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('attaches the payload to the request for an active user', async () => {
    const { guard } = createGuard(activeUser);
    const { req, context } = contextWith('Bearer token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual({ sub: 'user-1', email: 'ana@example.com' });
  });
});
