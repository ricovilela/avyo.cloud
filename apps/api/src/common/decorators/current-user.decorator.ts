import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { JwtPrincipal } from '../../modules/auth/jwt.strategy';

/**
 * Route-handler parameter decorator that resolves the authenticated tenant
 * identity.
 *
 * It reads the {@link JwtPrincipal} that {@link JwtAuthGuard} bound to
 * `request.user` and returns its `user_id` — the tenant identifier derived
 * solely from the validated Access_Token's `sub` claim. No other request data
 * or token claim can influence the resolved identity (Req 11.4).
 *
 * The decorator assumes an authenticated request; it is only meaningful on
 * routes protected by {@link JwtAuthGuard}, which guarantees `request.user` is
 * present.
 *
 * @example
 * ```ts
 * @UseGuards(JwtAuthGuard)
 * @Get('me')
 * getProfile(@CurrentUser() userId: string) {
 *   return this.service.findForTenant(userId);
 * }
 * ```
 *
 * Requirements: 11.4
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtPrincipal }>();
    return request.user.user_id;
  },
);
