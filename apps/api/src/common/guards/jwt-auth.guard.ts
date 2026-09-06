import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { UnauthenticatedException } from '../filters/app.exception';
import type { JwtPrincipal } from '../../modules/auth/jwt.strategy';

/**
 * Guard that authenticates requests using the Passport `jwt` strategy.
 *
 * On success the strategy's principal (`{ user_id }`, derived solely from the
 * token `sub`) is bound to `request.user` by Passport, making the tenant
 * identity available to downstream handlers and the `@CurrentUser()` decorator
 * (Req 11.1).
 *
 * On any failure — missing, malformed, invalid-signature, or expired token — it
 * rejects with the project's {@link UnauthenticatedException} so the error
 * envelope carries the `UNAUTHENTICATED` code (Req 10.4) and no tenant identity
 * is ever bound to the request (Req 11.2).
 *
 * Requirements: 10.4, 11.1, 11.2
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /**
   * Normalise Passport's outcome into the project's contract.
   *
   * Any error, or the absence of a validated principal, results in an
   * {@link UnauthenticatedException} rather than Nest's default
   * `UnauthorizedException`, guaranteeing the `UNAUTHENTICATED` envelope code
   * and that no tenant identity is bound on failure (Req 10.4, 11.2).
   *
   * @param err - An error raised during authentication, if any.
   * @param user - The validated principal, or a falsy value on failure.
   * @returns The authenticated {@link JwtPrincipal} when authentication succeeds.
   * @throws {UnauthenticatedException} on any authentication failure.
   */
  override handleRequest<TUser = JwtPrincipal>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      throw new UnauthenticatedException();
    }
    return user;
  }
}
