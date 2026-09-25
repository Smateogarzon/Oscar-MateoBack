import { ForbiddenException, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { QueryFailedError } from 'typeorm';
import { GqlAllExceptionsFilter } from './gql-all-exceptions.filter.js';

// Un contexto GraphQL: el filtro devuelve el error.
const graphqlHost = { getType: () => 'graphql' } as unknown as ArgumentsHost;

// Un contexto HTTP: el filtro tiene que escribir la respuesta.
function httpHost() {
  const response = {
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('GqlAllExceptionsFilter', () => {
  const filter = new GqlAllExceptionsFilter();
  const host = graphqlHost;
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

  it('answers an id that is not a uuid as a bad request, not as a server error', () => {
    process.env.NODE_ENV = 'production';
    const driverError = Object.assign(new Error('invalid input syntax for type uuid: "x"'), { code: '22P02' });
    const exception = new QueryFailedError('SELECT 1', [], driverError);

    const result = filter.catch(exception, host) as GraphQLError;

    expect(result.extensions.code).toBe('BAD_USER_INPUT');
    expect(result.message).not.toBe('Internal server error');
  });

  describe('peticiones HTTP', () => {
    it('escribe la respuesta de una HttpException con su código', () => {
      const { host: http, response } = httpHost();

      const returned = filter.catch(new ForbiddenException('Token CSRF inválido'), http);

      expect(returned).toBeUndefined();
      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Token CSRF inválido' }));
    });

    it('responde 500 (enmascarado en producción) a un error inesperado', () => {
      process.env.NODE_ENV = 'production';
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { host: http, response } = httpHost();

      filter.catch(new Error('detalle interno sensible'), http);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
    });

    it('no escribe nada si la respuesta ya empezó a enviarse', () => {
      const { host: http, response } = httpHost();
      response.headersSent = true;

      filter.catch(new NotFoundException(), http);

      expect(response.status).not.toHaveBeenCalled();
    });
  });
});
