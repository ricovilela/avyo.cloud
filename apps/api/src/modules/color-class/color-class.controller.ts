import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import type { ColorClass, Pagination_Envelope } from '@avyo/types';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { ColorClassService } from './color-class.service';

/**
 * HTTP entry point for `GET /color-class`.
 *
 * The controller stays thin: it applies the auth/verification guards and
 * delegates listing to {@link ColorClassService}. The response body is the
 * shared {@link Pagination_Envelope} keyed by `color_class`; the global
 * `SnakeCaseInterceptor` and `AllExceptionsFilter` handle serialization and
 * error shaping respectively.
 *
 * Guard order matters and is guaranteed left-to-right by NestJS:
 * {@link JwtAuthGuard} authenticates the Bearer token and binds
 * `request.user` (Req 1.6, 5.1) before {@link EmailVerifiedGuard} reads that
 * principal to gate on email verification (Req 5.3, 5.4).
 *
 * Requirements: 1.1, 1.4, 1.6, 5.1, 5.3, 5.4
 */
@Controller('color-class')
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
export class ColorClassController {
  constructor(private readonly service: ColorClassService) {}

  /**
   * `GET /color-class` — list every Color_Class in the global catalog (Req 1.1).
   *
   * Reachable only by a Verified_User once both guards pass. Returns `200`
   * with the single-page pagination envelope produced by the service; an empty
   * catalog yields a `200` empty list rather than an error (Req 1.3).
   *
   * @returns The pagination envelope holding the ordered Color_Class records.
   */
  @Get()
  @HttpCode(200)
  list(): Promise<Pagination_Envelope<{ color_class: ColorClass[] }>> {
    return this.service.list();
  }
}
