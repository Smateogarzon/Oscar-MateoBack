export const ACCESS_TOKEN_COOKIE = 'access_token';
export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';
// Empresa con la que el usuario está trabajando; el front la manda en cada petición.
export const COMPANY_HEADER = 'x-company-id';

export const ADMIN_TOKEN_TTL = '1h';
export const DEFAULT_TOKEN_TTL = '24h';

export const ADMIN_TOKEN_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
