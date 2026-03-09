import { HttpInterceptorFn } from '@angular/common/http';

/**
 * HTTP interceptor that attaches credentials (cookies) to all API requests.
 * Uses withCredentials so the browser sends mc_session and mc_refresh cookies
 * automatically to same-origin API endpoints.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const clonedReq = req.clone({ withCredentials: true });
  return next(clonedReq);
};
