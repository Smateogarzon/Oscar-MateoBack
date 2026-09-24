// Contenido del JWT una vez firmado; lo que los guards leen desde req.user. Solo identifica
// al usuario: qué puede hacer depende de la empresa y se consulta en cada petición
// (ver loadCompanyAccess), así un cambio de roles o permisos aplica de inmediato.
export interface JwtPayload {
  sub: string;
  email: string;
  // Los agrega el JWT al firmarse (segundos desde 1970): cuándo se emitió y cuándo vence. Solo están
  // en un payload ya verificado, no al crearlo.
  iat?: number;
  exp?: number;
}
