import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

/**
 * Route guard that checks whether the current user has the required roles.
 * Uses route data `requiredRoles` to determine which roles are needed.
 * At least one matching role grants access.
 */
export const roleGuard: CanActivateFn = async (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.init();

  const requiredRoles = route.data?.['requiredRoles'] as string[] | undefined;

  if (!requiredRoles || requiredRoles.length === 0) {
    return true;
  }

  const user = authService.currentUser();
  if (!user) {
    return router.createUrlTree(['/login']);
  }

  const hasRequiredRole = requiredRoles.some(role =>
    user.roles.includes(role as 'viewer' | 'operator' | 'admin'),
  );

  if (hasRequiredRole) {
    return true;
  }

  // Insufficient privileges — redirect to default dashboard
  return router.createUrlTree(['/']);
};
