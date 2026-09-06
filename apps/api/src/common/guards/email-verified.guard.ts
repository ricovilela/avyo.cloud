import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { EmailNotVerifiedException } from '../filters/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPrincipal } from '../../modules/auth/jwt.strategy';

/**
 * Guard that gates Business_Routes behind email verification.
 *
 * It assumes {@link JwtAuthGuard} has already run and bound the authenticated
 * principal (`{ user_id }`, derived solely from the token `sub`) to
 * `request.user`. It reads the user's `email_verified_at` timestamp and:
 *
 * - allows the request when the timestamp is non-null, i.e. the user is a
 *   Verified_User, subject to remaining authorization rules (Req 5.5);
 * - rejects the request with {@link EmailNotVerifiedException} (`403`,
 *   `EMAIL_NOT_VERIFIED`) when the timestamp is null — an Unverified_User — or
 *   when the user cannot be found, performing no state change (Req 5.4).
 *
 * All database access is behind {@link PrismaService} so it can be substituted
 * by a fake in tests.
 *
 * Requirements: 5.4, 5.5
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read-only gate: look up the authenticated user's `email_verified_at` and
   * permit the request only for a Verified_User.
   *
   * @param context - The current execution context; `request.user` is expected
   *   to have been populated by {@link JwtAuthGuard}.
   * @returns `true` when the user's email is verified (Req 5.5).
   * @throws {EmailNotVerifiedException} when the user is unverified or absent,
   *   with no state change (Req 5.4).
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: JwtPrincipal }>();
    const userId = request.user?.user_id;

    if (!userId) {
      throw new EmailNotVerifiedException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });

    if (!user || user.emailVerifiedAt === null) {
      throw new EmailNotVerifiedException();
    }

    return true;
  }
}
