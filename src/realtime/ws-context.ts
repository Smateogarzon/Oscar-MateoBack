import type { IncomingMessage } from 'node:http';
import type { Request, Response } from 'express';
import { COMPANY_HEADER } from '../graphql/auth/auth-cookie.constants.js';

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

export function wsOnConnect(context: WsServerContext): boolean {
  return isAllowedOrigin(requestOf(context)?.headers.origin, allowedOrigins());
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
