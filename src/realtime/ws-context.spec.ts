import {
  allowedOrigins,
  buildWsRequest,
  graphqlContext,
  isAllowedOrigin,
  parseCookies,
  wsOnConnect,
  type WsServerContext,
} from './ws-context.js';

// El contexto de graphql-ws de una conexión abierta desde un navegador
const wsContext = (
  headers: Record<string, string | undefined> = {},
  connectionParams?: Record<string, unknown> | null,
): WsServerContext => ({
  extra: { request: { headers } },
  connectionParams,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseCookies', () => {
  it('reads the cookies of the Cookie header', () => {
    expect(parseCookies('access_token=abc.def; csrf_token=xyz')).toEqual({
      access_token: 'abc.def',
      csrf_token: 'xyz',
    });
  });

  it('is empty when there is no header', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });

  it('decodes the value, takes the quotes off and ignores what is not a cookie', () => {
    expect(parseCookies('a=hola%20mundo; b="entre comillas"; suelta; =sinNombre')).toEqual({
      a: 'hola mundo',
      b: 'entre comillas',
    });
  });

  it('keeps the first one when a cookie comes twice, like cookie-parser', () => {
    expect(parseCookies('a=1; a=2').a).toBe('1');
  });

  it('keeps a value that cannot be decoded as it came', () => {
    expect(parseCookies('a=%E0%A4%A').a).toBe('%E0%A4%A');
  });

  it('keeps the "=" that is part of the value', () => {
    expect(parseCookies('token=aGk=').token).toBe('aGk=');
  });

  it('cannot be used to touch the prototype of the result', () => {
    const cookies = parseCookies('__proto__=x; constructor=y');

    expect(Object.getPrototypeOf(cookies)).toBeNull();
    expect(cookies.constructor).toBe('y');
    expect(({} as { polluted?: string }).polluted).toBeUndefined();
  });
});

describe('isAllowedOrigin', () => {
  const allowed = ['https://app.example.com', 'http://localhost:5173'];

  it('accepts the sites the app is served from', () => {
    expect(isAllowedOrigin('https://app.example.com', allowed)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', allowed)).toBe(true);
  });

  it('rejects any other site: it could be a page trying to use the cookies of the user', () => {
    expect(isAllowedOrigin('https://evil.example.net', allowed)).toBe(false);
    expect(isAllowedOrigin('https://app.example.com.evil.net', allowed)).toBe(false);
    expect(isAllowedOrigin('null', allowed)).toBe(false);
  });

  it('accepts a client that sends no origin: a browser always sends it, so it is not a browser', () => {
    expect(isAllowedOrigin(undefined, allowed)).toBe(true);
  });

  it('rejects every browser when no site is allowed', () => {
    expect(isAllowedOrigin('https://app.example.com', [])).toBe(false);
  });
});

describe('allowedOrigins', () => {
  it('reads the same sites CORS allows, separated by commas', () => {
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com, http://localhost:5173 ,');

    expect(allowedOrigins()).toEqual(['https://app.example.com', 'http://localhost:5173']);
  });

  it('is empty when nothing is configured', () => {
    vi.stubEnv('CORS_ORIGIN', '');

    expect(allowedOrigins()).toEqual([]);
  });
});

describe('wsOnConnect', () => {
  it('lets a connection open from an allowed site', () => {
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com');

    expect(wsOnConnect(wsContext({ origin: 'https://app.example.com' }))).toBe(true);
  });

  it('closes a connection that comes from another site', () => {
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com');

    expect(wsOnConnect(wsContext({ origin: 'https://evil.example.net' }))).toBe(false);
  });

  it('lets a client without origin in', () => {
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com');

    expect(wsOnConnect(wsContext({}))).toBe(true);
    expect(wsOnConnect({ extra: {} })).toBe(true);
  });
});

describe('buildWsRequest', () => {
  it('takes the session from the cookie of the connection and the company from the connection params', () => {
    const request = buildWsRequest(
      wsContext({ cookie: 'access_token=jwt; csrf_token=x' }, { companyId: 'company-1' }),
    );

    expect(request.cookies).toEqual({ access_token: 'jwt', csrf_token: 'x' });
    expect(request.headers).toEqual({ 'x-company-id': 'company-1' });
  });

  it('accepts the session in the connection params for a client that has no cookies', () => {
    const request = buildWsRequest(
      wsContext({}, { authorization: 'Bearer jwt', companyId: 'company-1' }),
    );

    expect(request.headers).toEqual({ authorization: 'Bearer jwt', 'x-company-id': 'company-1' });
    expect(request.cookies).toEqual({});
  });

  it('accepts the authorization of the handshake, and prefers the one of the params', () => {
    expect(buildWsRequest(wsContext({ authorization: 'Bearer del-handshake' })).headers).toEqual({
      authorization: 'Bearer del-handshake',
    });
    expect(
      buildWsRequest(
        wsContext({ authorization: 'Bearer del-handshake' }, { authorization: 'Bearer de-los-params' }),
      ).headers.authorization,
    ).toBe('Bearer de-los-params');
  });

  it('ignores params that are not text, instead of passing them to the guards', () => {
    const request = buildWsRequest(
      wsContext({}, { companyId: { $ne: null }, authorization: 42 }),
    );

    expect(request.headers).toEqual({});
  });

  it('works when the client sent no params, or the connection has no request', () => {
    expect(buildWsRequest(wsContext({}, null)).headers).toEqual({});
    expect(buildWsRequest({ extra: undefined }).cookies).toEqual({});
  });
});

describe('graphqlContext', () => {
  it('gives an HTTP request its req and res, as before', () => {
    const req = { headers: {} };
    const res = { cookie: vi.fn() };

    const context = graphqlContext({ req, res } as never);

    expect(context.req).toBe(req);
    expect(context.res).toBe(res);
  });

  it('builds the req of a subscription from its connection, and it has no res', () => {
    const context = graphqlContext(
      wsContext({ cookie: 'access_token=jwt' }, { companyId: 'company-1' }),
    );

    expect(context.req).toMatchObject({
      cookies: { access_token: 'jwt' },
      headers: { 'x-company-id': 'company-1' },
    });
    expect(context.res).toBeUndefined();
  });
});
