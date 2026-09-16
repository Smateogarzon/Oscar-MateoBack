import type { JwtPayload } from '../../graphql/auth/interface/jwt-payload.interface.js';

// JwtAuthGuard deja el payload verificado acá para que @CurrentUser() lo lea.
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
