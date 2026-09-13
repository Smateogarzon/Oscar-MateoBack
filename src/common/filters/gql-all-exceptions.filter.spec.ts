import { NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { GqlAllExceptionsFilter } from './gql-all-exceptions.filter.js';

describe('GqlAllExceptionsFilter', () => {
  const filter = new GqlAllExceptionsFilter();
  const host = {} as ArgumentsHost;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('passes through an existing GraphQLError untouched', () => {
    const error = new GraphQLError('boom');
    expect(filter.catch(error, host)).toBe(error);
  });

  it('preserves message and status for known Nest HttpExceptions', () => {
    const exception = new NotFoundException('Producto no encontrado');
    const result = filter.catch(exception, host) as GraphQLError;

    expect(result.message).toBe('Producto no encontrado');
    expect(result.extensions.code).toBe('NotFoundException');
    expect(result.extensions.status).toBe(404);
  });

  it('masks unexpected errors in production', () => {
    process.env.NODE_ENV = 'production';
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = filter.catch(
      new Error('detalle interno sensible'),
      host,
    ) as GraphQLError;

    expect(result.message).toBe('Internal server error');
    expect(result.extensions.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('shows the real error message outside production', () => {
    process.env.NODE_ENV = 'development';
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = filter.catch(
      new Error('detalle util para debug'),
      host,
    ) as GraphQLError;

    expect(result.message).toBe('detalle util para debug');
  });
});
