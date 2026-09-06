import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type {
  AuthMeResponse,
  LoginResponse,
  MenuEntry,
  RefreshResponse,
  SignupResponse,
} from '@avyo/types';

import { PrismaService } from '../../common/prisma/prisma.service';
import {
  ConflictException,
  UnauthenticatedException,
  UnprocessableException,
  ValidationException,
} from '../../common/filters/app.exception';
import { Argon2PasswordHasher } from './password.hasher';
import { CAPTCHA_VERIFIER, type CaptchaVerifier } from './ports/captcha-verifier';
import { MAILER, type Mailer } from './ports/mailer';
import { TokenService } from './token.service';
import { RefreshTokenService } from './refresh-token.service';
import type { SignupDto } from './dto/signup.dto';
import type { LoginDto } from './dto/login.dto';
import type { VerifyEmailDto } from './dto/verify-email.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { RefreshDto } from './dto/refresh.dto';

/**
 * Number of random bytes backing an opaque Email_Verification_Token
 * (256 bits of entropy). The raw value is delivered by email; only its hash is
 * persisted.
 */
export const VERIFICATION_TOKEN_BYTES = 32;

/**
 * Email_Verification_Token validity period in seconds (Req 5.2). The token is
 * valid for 24 hours from issuance.
 */
export const EMAIL_VERIFICATION_TTL_SECONDS = 86_400;

/**
 * Password_Reset_Token validity period in seconds (Req 6.1, 7.1). The token is
 * valid for 1 hour from issuance — deliberately shorter than the email
 * verification window because a reset grants a credential change.
 */
export const PASSWORD_RESET_TTL_SECONDS = 3_600;

/**
 * A precomputed, valid Argon2id encoded hash used solely for the login
 * anti-enumeration / constant-time branch (Req 2.5).
 *
 * When no user matches the presented email, the login flow still runs a real
 * password verification against this constant so that a non-existent account
 * performs the same memory-hard work as an existing one. This keeps response
 * timing indistinguishable between "unknown email" and "wrong password" and
 * prevents account enumeration via timing side channels. The plaintext behind
 * this hash is a fixed throwaway value and is never a real credential.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$nSKqDMxuRuv73O7ixK4Jng$MAiomE66lGni3TdSaHuubn99Tq2iQtu85kMYxcl/Lm4';

/**
 * Access_Token lifetime (seconds) reported in the login response `expires_in`
 * field (Req 2.1). Mirrors the default Access_Token lifetime.
 */
export const LOGIN_EXPIRES_IN_SECONDS = 86_400;

/**
 * Default plan assigned to a user profile when none is stored (Req 8.6).
 *
 * The `plan` column already defaults to `ctrlsale` at the database layer, but
 * this constant guarantees the `/auth/me` response never surfaces a null or
 * empty plan even if a legacy row lacks an assignment.
 */
export const DEFAULT_PLAN = 'ctrlsale';

/**
 * The Dynamic_Menu returned by `/auth/me` (Req 8.1, 8.2).
 *
 * Defined once at module scope as a frozen constant so the entry order is
 * deterministic and identical across every request for every user (Req 8.2).
 * Each entry carries non-empty `key`, `label`, `route`, and `icon` strings. The
 * entries mirror the MVP modules that map 1:1 to the application menu (see the
 * project structure steering): `bird`, `genetics`, `calendar`, `band`,
 * `band-color`, `cage`, `species`, `official-color`, `color-class`, `status`,
 * `management`, and `aviary`.
 *
 * `me()` returns a fresh shallow copy of this array so callers cannot mutate the
 * shared source while the canonical order is preserved.
 */
export const DYNAMIC_MENU: readonly MenuEntry[] = Object.freeze([
  { key: 'bird', label: 'Aves', route: '/bird', icon: 'bird' },
  { key: 'genetics', label: 'Genética', route: '/genetics', icon: 'dna' },
  { key: 'calendar', label: 'Calendário', route: '/calendar', icon: 'calendar' },
  { key: 'band', label: 'Anilhas', route: '/band', icon: 'ring' },
  { key: 'band-color', label: 'Cores de Anilha', route: '/band-color', icon: 'palette' },
  { key: 'cage', label: 'Gaiolas', route: '/cage', icon: 'grid' },
  { key: 'species', label: 'Espécies', route: '/species', icon: 'leaf' },
  { key: 'official-color', label: 'Cores Oficiais', route: '/official-color', icon: 'swatch' },
  { key: 'color-class', label: 'Classes de Cor', route: '/color-class', icon: 'layers' },
  { key: 'status', label: 'Situações', route: '/status', icon: 'tag' },
  { key: 'management', label: 'Manejos', route: '/management', icon: 'clipboard' },
  { key: 'aviary', label: 'Criatório', route: '/aviary', icon: 'home' },
] satisfies MenuEntry[]);

/**
 * Core authentication service backing the `/auth/*` endpoints.
 *
 * This is the foundational service for the auth module; each endpoint is a
 * discrete, self-contained method so subsequent endpoint tasks can extend this
 * class without disturbing existing flows. All persistence goes through
 * {@link PrismaService}; password hashing, captcha validation, and email
 * delivery are delegated to injected collaborators so the concrete providers
 * can be swapped behind their interfaces.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.9
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: Argon2PasswordHasher,
    @Inject(CAPTCHA_VERIFIER) private readonly captcha: CaptchaVerifier,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly tokenService: TokenService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  /**
   * Create a new account (Req 1.1–1.5, 1.7, 1.8).
   *
   * Flow:
   * 1. Normalize the email (trim + lowercase) so lookups and storage are
   *    case-insensitive (Req 1.5, 9.1).
   * 2. Verify the captcha challenge; failure is a `400 VALIDATION_ERROR`
   *    (Req 1.7).
   * 3. Reject a duplicate email with `409 CONFLICT` before creating anything
   *    (Req 1.5).
   * 4. Hash the password with the one-way hasher (Req 1.3).
   * 5. In a single transaction, create the User (`email_verified_at` null,
   *    `plan` `ctrlsale`) together with a single-use Email_Verification_Token
   *    (only its hash is persisted). Any failure rolls the transaction back and
   *    surfaces as `500 INTERNAL` with no partial record (Req 1.1, 1.8).
   * 6. Dispatch the verification email asynchronously (fire-and-forget) so the
   *    response is not blocked by mail delivery (Req 1.4).
   * 7. Return only `{ id, email, email_verified_at }` — never the password or
   *    its hash (Req 1.2, 1.3).
   *
   * @param dto - The validated signup request body.
   * @returns The public signup response.
   * @throws {ValidationException} when captcha validation fails (Req 1.7).
   * @throws {ConflictException} when the email already exists (Req 1.5).
   */
  async signup(dto: SignupDto): Promise<SignupResponse> {
    const email = dto.email.trim().toLowerCase();

    const captchaOk = await this.captcha.verify(dto.captcha0, dto.captcha1);
    if (!captchaOk) {
      throw new ValidationException('Captcha verification failed');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing !== null) {
      throw new ConflictException('Email address is already registered');
    }

    const passwordHash = await this.hasher.hash(dto.password);

    const rawToken = this.generateVerificationToken();
    const tokenHash = this.hashVerificationToken(rawToken);
    const expiresAt = new Date(
      Date.now() + EMAIL_VERIFICATION_TTL_SECONDS * 1000,
    );

    // Create the user and its verification token atomically; a failure rolls
    // back both so no partial record survives (Req 1.8).
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: dto.name,
          email,
          passwordHash,
          emailVerifiedAt: null,
          plan: 'ctrlsale',
        },
      });

      await tx.emailVerificationToken.create({
        data: {
          userId: created.id,
          tokenHash,
          expiresAt,
        },
      });

      return created;
    });

    // Fire-and-forget so mail delivery never blocks or fails the response
    // (Req 1.4).
    this.dispatchVerificationEmail(email, rawToken);

    return {
      id: user.id,
      email: user.email,
      email_verified_at: null,
    };
  }

  /**
   * Authenticate an existing account and issue a fresh session (Req 2.1–2.6,
   * 2.8).
   *
   * Flow:
   * 1. Verify the captcha challenge; failure is a `400 VALIDATION_ERROR`
   *    (Req 2.6).
   * 2. Normalize the email (trim + lowercase) and look the user up by it
   *    (Req 2.1, 9.1).
   * 3. Anti-enumeration / constant-time (Req 2.5): when no user matches, still
   *    perform a real Argon2id verification against {@link DUMMY_PASSWORD_HASH}
   *    (discarding the result) before throwing, so timing does not reveal
   *    account existence. When a user matches but the password is wrong, throw
   *    the same `401 UNAUTHENTICATED`. Both failures are indistinguishable — no
   *    field, message, or status differentiates unknown-email from
   *    wrong-password.
   * 4. On success, mint an HS256 Access_Token (Req 2.2) and issue a new
   *    Refresh_Token starting a fresh chain, recording the device fingerprint
   *    for auditing (Req 2.3, 2.4). Unverified users are still authenticated and
   *    receive tokens (Req 2.8); verification only gates business routes.
   * 5. Return the token pair with `token_type` `bearer` and `expires_in` the
   *    Access_Token lifetime in seconds (Req 2.1).
   *
   * @param dto - The validated login request body.
   * @returns The issued token pair.
   * @throws {ValidationException} when captcha validation fails (Req 2.6).
   * @throws {UnauthenticatedException} for unknown email or wrong password,
   *   indistinguishably (Req 2.5).
   */
  async login(dto: LoginDto): Promise<LoginResponse> {
    const captchaOk = await this.captcha.verify(dto.captcha0, dto.captcha1);
    if (!captchaOk) {
      throw new ValidationException('Captcha verification failed');
    }

    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user === null) {
      // Anti-enumeration: perform the same memory-hard verification a real
      // account would, then fail identically (Req 2.5). The boolean result is
      // intentionally ignored.
      await this.hasher.verify(DUMMY_PASSWORD_HASH, dto.password);
      throw new UnauthenticatedException();
    }

    const passwordOk = await this.hasher.verify(user.passwordHash, dto.password);
    if (!passwordOk) {
      throw new UnauthenticatedException();
    }

    // Unverified users still receive tokens (Req 2.8).
    const { token: accessToken } = this.tokenService.sign(user.id);
    const { rawToken: refreshToken } = await this.refreshTokenService.issue(
      user.id,
      dto.device,
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: LOGIN_EXPIRES_IN_SECONDS,
    };
  }

  /**
   * Confirm an account's email address from an Email_Verification_Token
   * (Req 5.1, 5.2).
   *
   * Flow:
   * 1. Hash the presented raw token with the same SHA-256 scheme used at signup
   *    ({@link hashVerificationToken}) and look the row up by its `token_hash`.
   * 2. Reject with `422 UNPROCESSABLE` when the token is unknown, already used
   *    (`used_at` set), or expired (`expires_at` at/ before now), leaving all
   *    state unchanged (Req 5.2).
   * 3. Otherwise, atomically stamp the user's `email_verified_at` with the
   *    current time and mark the token `used_at` so it cannot be replayed
   *    (single-use, Req 5.1). Field validation failures on the body are handled
   *    upstream by the global `ValidationPipe` as `400` (Req 5.3).
   *
   * @param dto - The validated verify-email request body.
   * @throws {UnprocessableException} when the token is unknown, used, or expired
   *   (Req 5.2).
   */
  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    const tokenHash = this.hashVerificationToken(dto.token);

    const token = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    const now = new Date();
    if (token === null || token.usedAt !== null || token.expiresAt <= now) {
      throw new UnprocessableException(
        'Verification token is invalid, used, or expired',
      );
    }

    // Stamp the user's verification time and burn the token atomically so a
    // partial success cannot leave a reusable token behind (Req 5.1).
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: now },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { usedAt: now },
      }),
    ]);
  }

  /**
   * Begin a password reset without disclosing account existence (Req 6.1–6.5).
   *
   * Flow:
   * 1. Normalize the email (trim + lowercase) so lookups match the stored,
   *    case-insensitive address (Req 9.1).
   * 2. Look the user up by email.
   * 3. If the account exists: mint a high-entropy Password_Reset_Token, persist
   *    only its SHA-256 hash with an `expires_at` of now +
   *    {@link PASSWORD_RESET_TTL_SECONDS}, then dispatch the reset email
   *    asynchronously (fire-and-forget) so the response time does not depend on
   *    mail delivery (Req 6.1).
   * 4. If the account does NOT exist: apply a constant-work floor (Req 6.5) —
   *    generate a throwaway token and compute its hash so the same synchronous
   *    crypto work runs on both branches — but never persist a token or send an
   *    email (Req 6.2).
   * 5. Always resolve to `void`; the controller returns `204` with an empty body
   *    on both branches, so neither status, body, nor timing reveals whether the
   *    account exists (Req 6.2, 6.4, 6.5). Malformed emails are rejected as
   *    `400` upstream by the global `ValidationPipe` before this runs (Req 6.3).
   *
   * @param dto - The validated forgot-password request body.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user === null) {
      // Constant-work floor (Req 6.5): perform the same token generation and
      // hashing a real account would, then discard it. No DB write, no email —
      // so the non-existent branch is indistinguishable in work and timing from
      // the existent branch without disclosing account existence (Req 6.2).
      const dummyToken = this.generateResetToken();
      void this.hashResetToken(dummyToken);
      return;
    }

    const rawToken = this.generateResetToken();
    const tokenHash = this.hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    // Fire-and-forget so response time is independent of mail delivery
    // (Req 6.1, 6.5).
    this.dispatchPasswordResetEmail(email, rawToken);
  }

  /**
   * Complete a password reset from a Password_Reset_Token (Req 7.1–7.5).
   *
   * Flow:
   * 1. Hash the presented raw token with the same SHA-256 scheme used at
   *    issuance ({@link hashResetToken}) and look the row up by its
   *    `token_hash`.
   * 2. Reject with `422 UNPROCESSABLE` when the token is unknown, already used
   *    (`used_at` set), or expired (`expires_at` at/before now), leaving the
   *    user's `password_hash` unchanged (Req 7.4).
   * 3. Otherwise, hash the new password with the one-way hasher (Req 7.1) and,
   *    in a single transaction, update the user's `password_hash` and mark the
   *    token `used_at` so it cannot be replayed (single-use, Req 7.2).
   * 4. After the transaction commits, revoke every active Refresh_Token for the
   *    user so existing sessions cannot outlive the credential change (Req 7.3).
   *    Field validation failures on the body are handled upstream by the global
   *    `ValidationPipe` as `400` (Req 7.5).
   *
   * @param dto - The validated reset-password request body.
   * @throws {UnprocessableException} when the token is unknown, used, or expired
   *   (Req 7.4).
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = this.hashResetToken(dto.token);

    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    const now = new Date();
    if (token === null || token.usedAt !== null || token.expiresAt <= now) {
      throw new UnprocessableException(
        'Reset token is invalid, used, or expired',
      );
    }

    const passwordHash = await this.hasher.hash(dto.password);

    // Update the credential and burn the token atomically so a partial success
    // cannot leave a reusable token behind (Req 7.1, 7.2).
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: now },
      }),
    ]);

    // Revoke all active refresh tokens so sessions cannot survive the
    // credential change (Req 7.3).
    await this.refreshTokenService.revokeAllForUser(token.userId);
  }

  /**
   * Return the authenticated user's profile plus the Dynamic_Menu (Req 8.1–8.6).
   *
   * Runs behind {@link JwtAuthGuard} only — no email-verified gate — so both
   * verified and unverified users can read their profile (Req 8.4).
   *
   * Flow:
   * 1. Look the user up by the tenant id the guard bound to the request,
   *    selecting only the public profile columns.
   * 2. Defensively reject with `401 UNAUTHENTICATED` if the row is absent; the
   *    guard guarantees a valid `sub`, but a deleted account could still present
   *    a live token, and no profile must leak in that case (Req 8.3).
   * 3. Build the `user` object with non-null `id`/`name`/`email`, a `plan`
   *    falling back to {@link DEFAULT_PLAN} when unassigned (Req 8.6), and
   *    `email_verified_at` as null for an Unverified_User or the ISO 8601
   *    verification timestamp once verified (Req 8.4, 8.5).
   * 4. Attach a copy of the order-stable {@link DYNAMIC_MENU} whose entries each
   *    carry non-empty `key`/`label`/`route`/`icon` in a fixed order identical
   *    across repeated requests (Req 8.1, 8.2).
   *
   * @param userId - The authenticated tenant id (token `sub`) bound by the guard.
   * @returns The profile and dynamic menu.
   * @throws {UnauthenticatedException} when no user matches the token subject
   *   (Req 8.3).
   */
  async me(userId: string): Promise<AuthMeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        plan: true,
        emailVerifiedAt: true,
      },
    });

    if (user === null) {
      throw new UnauthenticatedException();
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        plan: user.plan || DEFAULT_PLAN,
        email_verified_at:
          user.emailVerifiedAt !== null
            ? user.emailVerifiedAt.toISOString()
            : null,
      },
      menu: DYNAMIC_MENU.map((entry) => ({ ...entry })),
    };
  }

  /**
   * Rotate a Refresh_Token and mint a fresh session (Req 3.1–3.5).
   *
   * This endpoint is unguarded — the presented Refresh_Token is itself the
   * credential.
   *
   * Flow:
   * 1. Delegate to {@link RefreshTokenService.rotate}, which runs the rotation
   *    algorithm: a valid, unrevoked, unexpired, not-yet-rotated token is
   *    consumed and replaced by a fresh successor in the same chain (Req 3.1,
   *    3.2). An unknown, revoked, expired, or already-rotated (reused) token
   *    surfaces as `401 UNAUTHENTICATED`; reuse additionally revokes the entire
   *    chain (Req 3.3, 3.4). A missing/empty/whitespace `refresh_token` is
   *    rejected upstream as `400` by the global `ValidationPipe` (Req 3.5).
   * 2. Mint a new HS256 Access_Token for the rotated token's owner.
   * 3. Return the new token pair with `token_type` `bearer` and `expires_in` the
   *    Access_Token lifetime in seconds (Req 3.1).
   *
   * @param dto - The validated refresh request body.
   * @returns The freshly issued token pair.
   * @throws {UnauthenticatedException} when the token is invalid, revoked,
   *   expired, or reused (Req 3.3, 3.4).
   */
  async refresh(dto: RefreshDto): Promise<RefreshResponse> {
    const { rawToken: refreshToken, userId } =
      await this.refreshTokenService.rotate(dto.refresh_token);

    const { token: accessToken } = this.tokenService.sign(userId);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: LOGIN_EXPIRES_IN_SECONDS,
    };
  }

  /**
   * Revoke the Refresh_Token bound to the caller's current session (Req 4.1,
   * 4.4, 4.5).
   *
   * Design choice — which session to revoke: the Access_Token carries only
   * `sub` (the User id), never a session or Refresh_Token identifier, so it
   * cannot on its own name the session to terminate. The caller therefore
   * presents its own `refresh_token`, and this method revokes exactly that one
   * session by delegating to {@link RefreshTokenService.revokeSession} (which
   * matches on the token hash). Consequently:
   * - Only the presented session's Refresh_Token is revoked; every other active
   *   session of the same user is left untouched (Req 4.1, 4.5).
   * - The operation is idempotent: `revokeSession` is an `updateMany`, so
   *   revoking an already-revoked or unknown token changes nothing and does not
   *   throw — the endpoint still returns `204` (Req 4.4).
   *
   * Authentication is enforced upstream by {@link JwtAuthGuard}: a missing,
   * malformed, or expired Access_Token is rejected with `401 UNAUTHENTICATED`
   * before this method runs, so no revocation occurs on an unauthenticated call
   * (Req 4.2). Once revoked, subsequent refresh attempts with that token fail
   * with `401` via the rotation path (Req 4.3).
   *
   * @param refreshToken - The raw Refresh_Token identifying the session to end.
   */
  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokenService.revokeSession(refreshToken);
  }

  /**
   * Generate a new opaque, high-entropy Email_Verification_Token value.
   *
   * @returns A URL-safe base64 string carrying {@link VERIFICATION_TOKEN_BYTES}
   *   bytes of cryptographic randomness.
   */
  private generateVerificationToken(): string {
    return randomBytes(VERIFICATION_TOKEN_BYTES).toString('base64url');
  }

  /**
   * Derive the persisted `token_hash` for a raw Email_Verification_Token.
   *
   * Only this SHA-256 digest is stored, so a database read cannot reconstruct a
   * usable token; verification hashes the presented token and matches on the
   * digest. High token entropy makes a keyed HMAC unnecessary here.
   *
   * @param rawToken - The opaque token value delivered by email.
   * @returns The hex-encoded SHA-256 digest.
   */
  private hashVerificationToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Generate a new opaque, high-entropy Password_Reset_Token value.
   *
   * @returns A URL-safe base64 string carrying {@link VERIFICATION_TOKEN_BYTES}
   *   bytes of cryptographic randomness.
   */
  private generateResetToken(): string {
    return randomBytes(VERIFICATION_TOKEN_BYTES).toString('base64url');
  }

  /**
   * Derive the persisted `token_hash` for a raw Password_Reset_Token.
   *
   * Mirrors {@link hashVerificationToken}: only this SHA-256 digest is stored,
   * so a database read cannot reconstruct a usable token. High token entropy
   * makes a keyed HMAC unnecessary.
   *
   * @param rawToken - The opaque reset token delivered by email.
   * @returns The hex-encoded SHA-256 digest.
   */
  private hashResetToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Dispatch the verification email without blocking the caller (Req 1.4).
   *
   * Errors are swallowed so a mail-provider failure neither rejects the signup
   * response nor surfaces as an unhandled promise rejection.
   *
   * @param email - The recipient (normalized) email address.
   * @param rawToken - The raw verification token to embed in the email.
   */
  private dispatchVerificationEmail(email: string, rawToken: string): void {
    void this.mailer.sendVerificationEmail(email, rawToken).catch(() => {
      // Intentionally ignored: delivery is best-effort and must not affect the
      // signup response path.
    });
  }

  /**
   * Dispatch the password reset email without blocking the caller (Req 6.1,
   * 6.5).
   *
   * Errors are swallowed so a mail-provider failure neither rejects the
   * forgot-password response nor surfaces as an unhandled promise rejection,
   * and so response timing stays independent of delivery.
   *
   * @param email - The recipient (normalized) email address.
   * @param rawToken - The raw reset token to embed in the email.
   */
  private dispatchPasswordResetEmail(email: string, rawToken: string): void {
    void this.mailer.sendPasswordResetEmail(email, rawToken).catch(() => {
      // Intentionally ignored: delivery is best-effort and must not affect the
      // forgot-password response path.
    });
  }
}
