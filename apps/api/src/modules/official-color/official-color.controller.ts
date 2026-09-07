import { Controller, Get, HttpCode, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { ListOfficialColorQueryDto } from './dto/list-official-color.query.dto';
import { OfficialColorService } from './official-color.service';

/**
 * `GET /official-color` — read-only listing of the GLOBAL official color
 * catalog.
 *
 * Both guards run in order: {@link JwtAuthGuard} rejects unauthenticated
 * requests with `401 UNAUTHENTICATED` (Req 5.1), then {@link EmailVerifiedGuard}
 * rejects authenticated-but-unverified users with `403 EMAIL_NOT_VERIFIED`
 * (Req 5.3). Only a verified, authenticated caller reaches the handler
 * (Req 5.4).
 */
@Controller('official-color')
@UseGuards(JwtAuthGuard, EmailVerifiedGuard)
export class OfficialColorController {
  constructor(private readonly service: OfficialColorService) {}

  /**
   * List official colors, optionally filtered by `class_id` / `age_group`.
   *
   * Always responds `200` with a single-page pagination envelope, including
   * for an empty result set (Req 2.1, 2.4, 2.7). Query validation is handled by
   * the global `ValidationPipe` against {@link ListOfficialColorQueryDto}.
   */
  @Get()
  @HttpCode(200)
  list(@Query() query: ListOfficialColorQueryDto) {
    return this.service.list(query);
  }
}
