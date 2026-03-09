import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CsrfService } from '../services/csrf.service';

/**
 * HTTP interceptor that adds the X-CSRF-Token header to all non-GET requests.
 * Reads the CSRF token from the mc_csrf cookie via CsrfService.
 */
export const csrfInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next(req);
  }

  const csrfService = inject(CsrfService);
  const token = csrfService.getCsrfToken();

  if (token) {
    const clonedReq = req.clone({
      setHeaders: { 'X-CSRF-Token': token },
    });
    return next(clonedReq);
  }

  return next(req);
};
