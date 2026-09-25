import {
  allowedOrigins,
  buildWsRequest,
  graphqlContext,
  isAllowedOrigin,
  parseCookies,
  resetWsConnectionCounters,
  wsOnClose,
  wsOnConnect,
  wsOnSubscribe,
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
  const session = { cookie: 'access_token=jwt' };

  beforeEach(() => {
    resetWsConnectionCounters();
  });

  it('lets a connection open from an allowed site that brings a session', () => {
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com');

    expect(wsOnConnect(wsContext({ origin: 'https://app.example.com', ...session }))).toBe(true);
  });

  it('closes a connection that comes from another site', () => {
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com');

    expect(wsOnConnect(wsContext({ origin: 'https://evil.example.net', ...session }))).toBe(false);
  });

  it('lets a client without origin in, as long as it brings a session', () => {
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com');

    expect(wsOnConnect(wsContext({ ...session }))).toBe(true);
  });

  it('closes a connection that brings no credentials at all', () => {
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com');

    expect(wsOnConnect(wsContext({ origin: 'https://app.example.com' }))).toBe(false);
    expect(wsOnConnect({ extra: {} })).toBe(false);
  });

  it('accepts an authorization token from the connection params instead of the cookie', () => {
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com');

    expect(wsOnConnect(wsContext({}, { authorization: 'Bearer abc' }))).toBe(true);
  });

  it('refuses more open connections from the same IP than the limit, and frees the slot on close', () => {
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com');
    const fromIp = () => wsContext({ ...session, 'x-forwarded-for': '203.0.113.7' });

    const opened = Array.from({ length: 30 }, () => {
      const context = fromIp();
      return { context, ok: wsOnConnect(context) };
    });
    expect(opened.every((connection) => connection.ok)).toBe(true);
    expect(wsOnConnect(fromIp())).toBe(false);

    // Otra IP no se ve afectada
    expect(wsOnConnect(wsContext({ ...session, 'x-forwarded-for': '198.51.100.9' }))).toBe(true);

    wsOnClose(opened[0].context);
    expect(wsOnConnect(fromIp())).toBe(true);
  });

  it('does not free a slot for a connection that was never counted', () => {
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com');
    const counted = wsContext({ ...session, 'x-forwarded-for': '203.0.113.7' });
    wsOnConnect(counted);

    // Un socket que se cierra sin haber pasado por onConnect no descuenta nada
    wsOnClose(wsContext({ 'x-forwarded-for': '203.0.113.7' }));
    wsOnClose(counted);
    wsOnClose(counted);

    // Todo quedó en cero: 30 conexiones nuevas de esa IP caben otra vez
    const again = Array.from({ length: 30 }, () =>
      wsOnConnect(wsContext({ ...session, 'x-forwarded-for': '203.0.113.7' })),
    );
    expect(again.every(Boolean)).toBe(true);
  });
});

describe('wsOnSubscribe', () => {
  const subscribe = (query: unknown) => wsOnSubscribe({}, 'id-1', { query });

  it('lets the notificationEvents subscription through', () => {
    expect(
      subscribe('subscription NotificationEvents { notificationEvents { kind channel entityId } }'),
    ).toBeUndefined();
  });

  it('rejects a query or a mutation: the WebSocket is only for the subscription', () => {
    expect(subscribe('query { me { id } }')).toHaveLength(1);
    expect(subscribe('mutation { logout }')).toHaveLength(1);
  });

  it('rejects an introspection query', () => {
    expect(subscribe('{ __schema { types { name } } }')).toHaveLength(1);
  });

  it('rejects a subscription to anything else', () => {
    expect(subscribe('subscription { somethingElse { id } }')).toHaveLength(1);
  });

  it('rejects a document with more than one operation or definition', () => {
    expect(
      subscribe(
        'subscription A { notificationEvents { kind } } subscription B { notificationEvents { kind } }',
      ),
    ).toHaveLength(1);
  });

  it('rejects a huge query without even parsing it', () => {
    const hostile = `subscription { notificationEvents { ${'__typename '.repeat(500)} } }`;

    expect(hostile.length).toBeGreaterThan(2000);
    expect(subscribe(hostile)).toHaveLength(1);
  });

  it('rejects an empty payload and an invalid document', () => {
    expect(subscribe(undefined)).toHaveLength(1);
    expect(subscribe('')).toHaveLength(1);
    expect(subscribe('subscription {')).toHaveLength(1);
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
