import { randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  ADMIN_TOKEN_TTL_MS,
  CSRF_COOKIE,
  DEFAULT_TOKEN_TTL_MS,
} from './auth-cookie.constants.js';

// En local queda sin definir (localhost comparte cookies entre puertos); en producción es
// el dominio principal, para que la cookie CSRF sea visible también desde el front.
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

// Deja la sesión en el navegador: la cookie de acceso (solo del host de la API, HttpOnly) y el token CSRF
// (legible por el front). Lo usan el inicio de sesión y el cambio de contraseña, que renueva la sesión de
// quien la cambia.
export function setSessionCookies(res: Response, accessToken: string, isAdmin: boolean): void {
  // Front (tiendadeoscarymateo.com) y API (server.tiendadeoscarymateo.com) son el mismo
  // sitio, así que 'lax' alcanza y además impide que sitios ajenos usen la sesión.
  const baseCookieOptions: CookieOptions = {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: isAdmin ? ADMIN_TOKEN_TTL_MS : DEFAULT_TOKEN_TTL_MS,
    path: '/',
  };

  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
    ...baseCookieOptions,
    httpOnly: true,
  });

  // La sesión queda solo en el host de la API, pero el token CSRF lo tiene que leer el
  // JavaScript del front, que vive en otro subdominio: se declara para todo el dominio.
  res.cookie(CSRF_COOKIE, randomBytes(32).toString('hex'), {
    ...baseCookieOptions,
    httpOnly: false,
    domain: COOKIE_DOMAIN,
  });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/', domain: COOKIE_DOMAIN });
}
