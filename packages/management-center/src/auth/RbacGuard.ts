/**
 * Role-based access control guard with hierarchical role checking.
 *
 * Uses NestJS Reflector to read @RequireRoles() metadata from route handlers.
 * Role hierarchy: viewer < operator < admin. A user with 'admin' satisfies
 * any role requirement. Also supports cluster-scope restrictions via
 * user.clusterScopes.
 */

import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationError, AuthenticationError } from '../shared/errors.js';
import type { User } from '../shared/types.js';

export type Role = 'viewer' | 'operator' | 'admin';

const ROLES_KEY = 'mc_required_roles';

/**
 * Decorator that marks a route handler as requiring one or more roles.
 * If multiple roles are specified, the user needs at least one of them.
 */
export const RequireRoles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

const ROLE_HIERARCHY: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
};

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: User | undefined = request.mcUser;

    if (!user) {
      throw new AuthenticationError('Authentication required');
    }

    const minRequired = Math.min(...requiredRoles.map((r) => ROLE_HIERARCHY[r]));
    const userMaxRole = Math.max(...user.roles.map((r) => ROLE_HIERARCHY[r]));

    if (userMaxRole < minRequired) {
      throw new AuthorizationError('Insufficient role permissions');
    }

    const clusterId: string | undefined = request.params?.clusterId ?? request.body?.clusterId;
    if (clusterId && user.clusterScopes.length > 0 && !user.clusterScopes.includes(clusterId)) {
      throw new AuthorizationError('Access denied for this cluster');
    }

    return true;
  }
}
