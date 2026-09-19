import type { CompanyAccess } from '../access/company-access.js';
import type { JwtPayload } from '../../graphql/auth/interface/jwt-payload.interface.js';

// JwtAuthGuard deja el payload verificado acá para que @CurrentUser() lo lea, y
// PermissionsGuard deja lo que el usuario puede hacer en la empresa activa.
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      companyAccess?: CompanyAccess;
    }
  }
}
