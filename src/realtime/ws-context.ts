import type { IncomingMessage } from 'node:http';
import type { Request, Response } from 'express';
import { GraphQLError, Kind, parse, type DocumentNode } from 'graphql';
import { ACCESS_TOKEN_COOKIE, COMPANY_HEADER } from '../graphql/auth/auth-cookie.constants.js';

export interface WsServerContext {
  readonly extra: unknown;
  readonly connectionParams?: Readonly<Record<string, unknown>> | null;
}

type HandshakeRequest = Pick<IncomingMessage, 'headers'>;

function requestOf(context: WsServerContext): HandshakeRequest | undefined {
  return (context.extra as { request?: HandshakeRequest } | null | undefined)
    ?.request;
}

export interface WsRequest {
  headers: Record<string, string>;
  cookies: Record<string, string>;
}

export function parseCookies(
  header: string | undefined,
): Record<string, string> {
  const cookies = Object.create(null) as Record<string, string>;
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;

    const name = part.slice(0, separator).trim();
    if (!name || name in cookies) continue;

    let value = part.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function isAllowedOrigin(
  origin: string | undefined,
  allowed: string[],
): boolean {
  if (origin === undefined) return true;
  return allowed.includes(origin);
}

// Límites de conexiones abiertas (el POS de una tienda usa unas pocas): tope en total y por IP, para que
// alguien no agote descriptores y memoria abriendo miles de sockets.
const MAX_WS_CONNECTIONS = 500;
const MAX_WS_CONNECTIONS_PER_IP = 30;
// Una suscripción de estas es solo una señal: una consulta más larga que esto no es del front.
const MAX_WS_QUERY_LENGTH = 2000;
// Por el WebSocket solo se admite esta suscripción: no queries, no mutaciones, no introspección.
const ALLOWED_SUBSCRIPTION_FIELD = 'notificationEvents';

let openConnections = 0;
const connectionsPerIp = new Map<string, number>();

interface CountedExtra {
  wsCounted?: { ip: string };
}

// La IP del cliente: detrás de Caddy llega en X-Forwarded-For (Caddy la pone él, no el cliente); sin
// proxy, la del socket.
function clientIp(context: WsServerContext): string {
  const request = requestOf(context) as
    | (HandshakeRequest & { socket?: { remoteAddress?: string } })
    | undefined;
  const forwarded = request?.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || request?.socket?.remoteAddress || 'desconocida';
}

// ¿Trae alguna credencial? Se comprueba que haya cookie de sesión o cabecera Authorization, sin
// verificarla (eso lo hace JwtAuthGuard en cada suscripción): basta para cortar de raíz a quien abre el
// socket sin ninguna sesión, antes de que pueda mandar nada.
function hasCredentials(context: WsServerContext): boolean {
  const request = buildWsRequest(context);
  return Boolean(request.cookies[ACCESS_TOKEN_COOKIE] || request.headers.authorization);
}

// Devolver false cierra la conexión (código 4403). Se rechaza: un origen que no es la app, una conexión
// sin ninguna credencial, o demasiadas conexiones abiertas (en total o desde la misma IP).
export function wsOnConnect(context: WsServerContext): boolean {
  if (!isAllowedOrigin(requestOf(context)?.headers.origin, allowedOrigins())) return false;
  if (!hasCredentials(context)) return false;

  const ip = clientIp(context);
  const fromIp = connectionsPerIp.get(ip) ?? 0;
  if (openConnections >= MAX_WS_CONNECTIONS || fromIp >= MAX_WS_CONNECTIONS_PER_IP) return false;

  openConnections += 1;
  connectionsPerIp.set(ip, fromIp + 1);
  const extra = context.extra as CountedExtra | null | undefined;
  if (extra) extra.wsCounted = { ip };
  return true;
}

// Se llama SIEMPRE al cerrarse un socket, haya pasado o no `onConnect`: solo se descuenta el que se contó.
export function wsOnClose(context: WsServerContext): void {
  const counted = (context.extra as CountedExtra | null | undefined)?.wsCounted;
  if (!counted) return;
  (context.extra as CountedExtra).wsCounted = undefined;

  openConnections = Math.max(0, openConnections - 1);
  const remaining = (connectionsPerIp.get(counted.ip) ?? 1) - 1;
  if (remaining <= 0) connectionsPerIp.delete(counted.ip);
  else connectionsPerIp.set(counted.ip, remaining);
}

// Antes de procesar nada de una suscripción: por este canal solo se admite UNA suscripción a
// `notificationEvents`, corta. El WebSocket no pasa por las defensas del canal HTTP (GraphQL Armor,
// introspección apagada), así que sin esto un mensaje hostil —miles de campos repetidos que hacen
// cuadrática la validación, o una introspección recursiva— podía bloquear el proceso entero.
export function wsOnSubscribe(
  _context: unknown,
  _id: string,
  payload: { query?: unknown },
): readonly GraphQLError[] | void {
  const query = typeof payload.query === 'string' ? payload.query : '';
  if (query.length === 0 || query.length > MAX_WS_QUERY_LENGTH) {
    return [new GraphQLError('Consulta no permitida')];
  }

  let document: DocumentNode;
  try {
    document = parse(query);
  } catch {
    return [new GraphQLError('Consulta inválida')];
  }

  // Un solo documento con una sola operación: una suscripción cuyos campos son todos notificationEvents
  const only = document.definitions.length === 1 ? document.definitions[0] : undefined;
  const allowed =
    only?.kind === Kind.OPERATION_DEFINITION &&
    only.operation === 'subscription' &&
    only.selectionSet.selections.every(
      (selection) => selection.kind === Kind.FIELD && selection.name.value === ALLOWED_SUBSCRIPTION_FIELD,
    );
  if (!allowed) {
    return [new GraphQLError(`Por este canal solo se admite la suscripción ${ALLOWED_SUBSCRIPTION_FIELD}`)];
  }
}

// Para las pruebas: deja los contadores en cero.
export function resetWsConnectionCounters(): void {
  openConnections = 0;
  connectionsPerIp.clear();
}

export function buildWsRequest(context: WsServerContext): WsRequest {
  const headers = requestOf(context)?.headers;
  const params = context.connectionParams ?? {};

  const authorization =
    typeof params.authorization === 'string'
      ? params.authorization
      : headers?.authorization;
  const companyId =
    typeof params.companyId === 'string' ? params.companyId : undefined;

  return {
    headers: {
      ...(authorization && { authorization }),
      ...(companyId && { [COMPANY_HEADER]: companyId }),
    },
    cookies: parseCookies(headers?.cookie),
  };
}

export function graphqlContext(
  source: { req: Request; res: Response } | WsServerContext,
): { req: unknown; res?: Response } {
  if ('extra' in source) return { req: buildWsRequest(source) };
  return { req: source.req, res: source.res };
}
