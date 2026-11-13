import { NextFunction, Request, Response } from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { DecodedIdToken, getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import { UserRole } from '../types.ts';

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminAuth = getAuth();

export interface AuthContext {
  uid: string;
  email: string | null;
  role: UserRole;
  authenticated: boolean;
  decodedToken?: DecodedIdToken;
}

export interface RequestWithAuth extends Request {
  authContext?: AuthContext;
}

const ALLOWED_ROLES: UserRole[] = [
  'STATE_ADMIN',
  'MANUFACTURER',
  'CNF_AGENT',
  'SUPER_STOCKIST',
  'WHOLESALER',
  'LOCAL_DISTRIBUTOR',
  'RETAIL_PHARMACY',
  'HOSPITAL_PHARMACY',
];

export async function attachAuthContext(
  req: RequestWithAuth,
  _res: Response,
  next: NextFunction
) {
  const headerRole = (req.headers['x-operator-role'] as string | undefined)?.toUpperCase() as
    | UserRole
    | undefined;
  const requestedRole: UserRole =
    headerRole && ALLOWED_ROLES.includes(headerRole) ? headerRole : 'STATE_ADMIN';

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) {
      try {
        const decoded = await adminAuth.verifyIdToken(token);
        req.authContext = {
          uid: decoded.uid,
          email: decoded.email ?? null,
          role: requestedRole,
          authenticated: true,
          decodedToken: decoded,
        };
        return next();
      } catch {
        // Fall through to unauthenticated context; protected endpoints check authenticated/role
      }
    }
  }

  req.authContext = {
    uid: 'demo-mp-coordinator',
    email: null,
    role: requestedRole,
    authenticated: false,
  };
  next();
}

export function requireAuthorizedRole(allowedRoles: UserRole[]) {
  return (req: RequestWithAuth, res: Response, next: NextFunction) => {
    const ctx = req.authContext;
    if (!ctx) {
      return res.status(401).json({ error: 'Missing operator context.' });
    }
    if (!allowedRoles.includes(ctx.role)) {
      return res.status(403).json({
        error: `Role ${ctx.role} is not permitted for this operation. Permitted roles: ${allowedRoles.join(', ')}.`,
      });
    }
    next();
  };
}
