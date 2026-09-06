import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import type {
  AuthMeResponse,
  LoginResponse,
  RefreshResponse,
  SignupResponse,
} from '@avyo/types';

import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshDto } from './dto/refresh.dto';

/**
 * HTTP entry point for the `/auth/*` endpoints.
 *
 * Controllers stay thin: each handler validates its body via the DTO (through
 * the global `ValidationPipe`), applies the route's guards, and delegates the
 * work to {@link AuthService}. Subsequent endpoint tasks add their handlers to
 * this class alongside `signup`.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * `POST /auth/signup` — create a new account (Req 1.1, 1.2, 1.9).
   *
   * Guarded by {@link RateLimitGuard} so abusive request volumes are rejected
   * with `429 RATE_LIMITED` before the handler runs (Req 1.9). On success it
   * responds `201` with `{ id, email, email_verified_at }`, never exposing the
   * password or its hash (Req 1.2, 1.3).
   *
   * @param dto - The validated signup request body.
   * @returns The public signup response.
   */
  @Post('signup')
  @UseGuards(RateLimitGuard)
  @HttpCode(201)
  signup(@Body() dto: SignupDto): Promise<SignupResponse> {
    return this.authService.signup(dto);
  }

  /**
   * `POST /auth/login` — authenticate and issue a session (Req 2.1, 2.2).
   *
   * Guarded by {@link RateLimitGuard} so credential-stuffing volumes are
   * rejected with `429 RATE_LIMITED` before the handler runs. On success it
   * responds `200` with `{ access_token, refresh_token, token_type, expires_in }`.
   * Unknown email and wrong password both surface as `401 UNAUTHENTICATED`
   * (Req 2.5); unverified users are still authenticated (Req 2.8).
   *
   * @param dto - The validated login request body.
   * @returns The issued token pair.
   */
  @Post('login')
  @UseGuards(RateLimitGuard)
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto);
  }

  /**
   * `POST /auth/refresh` — rotate a Refresh_Token and issue a new session
   * (Req 3.1–3.5).
   *
   * Unguarded per the design's controller table: the opaque Refresh_Token is
   * itself the credential, so no auth guard applies. On success it responds
   * `200` with `{ access_token, refresh_token, token_type, expires_in }` where
   * the refresh token is a freshly rotated successor (Req 3.1, 3.2). An invalid,
   * revoked, expired, or reused token surfaces as `401 UNAUTHENTICATED`, and
   * reuse revokes the whole chain (Req 3.3, 3.4). A missing, empty, or
   * whitespace-only `refresh_token` is rejected as `400 VALIDATION_ERROR` by the
   * global `ValidationPipe` before this handler runs (Req 3.5).
   *
   * @param dto - The validated refresh request body.
   * @returns The freshly issued token pair.
   */
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<RefreshResponse> {
    return this.authService.refresh(dto);
  }

  /**
   * `POST /auth/verify-email` — confirm an account's email address (Req 5.1,
   * 5.2, 5.3).
   *
   * Unguarded per the design's controller table: the opaque token is the only
   * credential required. A valid, unused, unexpired token marks the account
   * verified and responds `204` with an empty body; an unknown, used, or
   * expired token surfaces as `422 UNPROCESSABLE` (Req 5.2). Malformed bodies
   * are rejected as `400` by the global `ValidationPipe` before this handler
   * runs (Req 5.3).
   *
   * @param dto - The validated verify-email request body.
   */
  @Post('verify-email')
  @HttpCode(204)
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    return this.authService.verifyEmail(dto);
  }

  /**
   * `POST /auth/forgot-password` — begin a password reset (Req 6.1–6.5).
   *
   * Guarded by {@link RateLimitGuard} so abusive request volumes are rejected
   * with `429 RATE_LIMITED` before the handler runs. For any well-formed email
   * it always responds `204` with an empty body, whether or not the account
   * exists, so account existence is never disclosed by status, body, or timing
   * (Req 6.2, 6.4, 6.5); a reset email is dispatched only for existing accounts
   * (Req 6.1). Malformed emails are rejected as `400 VALIDATION_ERROR` by the
   * global `ValidationPipe` before this handler runs (Req 6.3).
   *
   * @param dto - The validated forgot-password request body.
   */
  @Post('forgot-password')
  @UseGuards(RateLimitGuard)
  @HttpCode(204)
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    return this.authService.forgotPassword(dto);
  }

  /**
   * `POST /auth/reset-password` — complete a password reset (Req 7.1–7.5).
   *
   * Unguarded per the design's controller table: the opaque reset token is the
   * only credential required. A valid, unused, unexpired token updates the
   * account's password, burns the token, revokes all active refresh tokens, and
   * responds `204` with an empty body (Req 7.1, 7.2, 7.3); an unknown, used, or
   * expired token surfaces as `422 UNPROCESSABLE` with the password left
   * unchanged (Req 7.4). Malformed bodies are rejected as `400 VALIDATION_ERROR`
   * by the global `ValidationPipe` before this handler runs (Req 7.5).
   *
   * @param dto - The validated reset-password request body.
   */
  @Post('reset-password')
  @HttpCode(204)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.authService.resetPassword(dto);
  }

  /**
   * `POST /auth/me` — return the authenticated profile and dynamic menu
   * (Req 8.1–8.6).
   *
   * Guarded by {@link JwtAuthGuard} only and deliberately **not** the
   * email-verified gate, so both verified and unverified users can read their
   * profile (Req 8.4). The guard binds the tenant identity from the validated
   * Access_Token; a missing, invalid, or expired token is rejected with
   * `401 UNAUTHENTICATED` before this handler runs and no `user`/`menu` is
   * emitted (Req 8.3). On success it responds `200` with `{ user, menu }` — the
   * method is POST to match the design's controller table.
   *
   * @param userId - The authenticated tenant id resolved from the token `sub`.
   * @returns The profile and dynamic menu.
   */
  @Post('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  me(@CurrentUser() userId: string): Promise<AuthMeResponse> {
    return this.authService.me(userId);
  }

  /**
   * `POST /auth/logout` — revoke the caller's current session (Req 4.1–4.5).
   *
   * Guarded by {@link JwtAuthGuard}: a missing, non-`Bearer`, expired, or
   * otherwise invalid Access_Token is rejected with `401 UNAUTHENTICATED`
   * before this handler runs, so no Refresh_Token is revoked on an
   * unauthenticated call (Req 4.2). The Access_Token carries only the tenant
   * id, so the specific session to end is identified by the presented
   * `refresh_token` (reusing {@link RefreshDto}); the authenticated `userId` is
   * available from the guard for auditing. On success it revokes exactly that
   * session's Refresh_Token — leaving all other sessions untouched (Req 4.1,
   * 4.5) — and responds `204` with an empty body. The call is idempotent: if the
   * session's Refresh_Token was already revoked it still responds `204` without
   * changing any additional state (Req 4.4). Once revoked, later refresh
   * attempts with that token fail with `401` (Req 4.3).
   *
   * @param userId - The authenticated tenant id resolved from the token `sub`.
   * @param dto - The validated logout request body carrying the `refresh_token`.
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  logout(
    @CurrentUser() userId: string,
    @Body() dto: RefreshDto,
  ): Promise<void> {
    return this.authService.logout(dto.refresh_token);
  }
}
