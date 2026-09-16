// Contenido del JWT una vez firmado; lo que los guards leen desde req.user
export interface JwtPayload {
  sub: string;
  email: string;
  isAdmin: boolean;
  roleCodes: string[];
  permissionCodes: string[];
}
