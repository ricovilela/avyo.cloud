import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { ConfigModule } from '../../config/config.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { RefreshTokenService } from './refresh-token.service';
import { Argon2PasswordHasher } from './password.hasher';
import { JwtStrategy } from './jwt.strategy';
import { CAPTCHA_VERIFIER } from './ports/captcha-verifier';
import { MAILER } from './ports/mailer';
import { RATE_LIMITER } from './ports/rate-limiter';
import { DevCaptchaVerifier } from './ports/fakes/dev-captcha-verifier';
import { RecordingMailer } from './ports/fakes/recording-mailer';
import { InMemoryRateLimiter } from './ports/fakes/in-memory-rate-limiter';

/**
 * Auth module wiring for the `/auth/*` endpoints.
 *
 * Imports:
 * - {@link ConfigModule} so the validated {@link Config} is injectable under the
 *   `CONFIG` token (it is `@Global`, but it is imported here explicitly to make
 *   the dependency of {@link TokenService}/{@link RefreshTokenService}/
 *   {@link JwtStrategy} on `CONFIG` self-documenting).
 * - {@link JwtModule} registered with an empty config: secrets/algorithm are
 *   passed per sign/verify call in {@link TokenService}, so no module-level
 *   secret is needed.
 * - {@link PassportModule} with the `jwt` default strategy so {@link JwtStrategy}
 *   (registered as a provider) backs {@link JwtAuthGuard}.
 *
 * Provider bindings for the provider-agnostic ports currently resolve to the
 * in-memory dev/test fakes ({@link DevCaptchaVerifier}, {@link RecordingMailer},
 * {@link InMemoryRateLimiter}). These are the config-driven defaults until the
 * concrete captcha / mailer / rate-limit-store providers are approved (see the
 * "Dependencies to confirm" section of the auth design).
 *
 * Requirements: 10.1, 12.1, 12.3
 */
@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    RefreshTokenService,
    Argon2PasswordHasher,
    JwtStrategy,
    PrismaService,
    RateLimitGuard,
    JwtAuthGuard,
    EmailVerifiedGuard,
    // Dev/test default bindings for the provider-agnostic ports. Swap these for
    // concrete implementations once the captcha/mailer/rate-limit providers are
    // approved.
    { provide: CAPTCHA_VERIFIER, useClass: DevCaptchaVerifier },
    { provide: MAILER, useClass: RecordingMailer },
    { provide: RATE_LIMITER, useClass: InMemoryRateLimiter },
  ],
  exports: [JwtAuthGuard, EmailVerifiedGuard],
})
export class AuthModule {}
