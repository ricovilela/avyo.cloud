import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { buildEnvelope } from '../../common/pagination/build-envelope';
import type { ListOfficialColorQueryDto } from './dto/list-official-color.query.dto';

/**
 * Read-only access to the GLOBAL `official_color` catalog.
 *
 * Official colors are official/global reference data shared identically across
 * every tenant, so listing applies **no `user_id`/tenant filter** (Req 2.2).
 */
@Injectable()
export class OfficialColorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List Official_Color records, optionally filtered by `class_id` and/or
   * `age_group`.
   *
   * Filters are ANDed and applied only when present, so an omitted filter
   * widens the result set rather than narrowing it (Req 3.2, 4.1, 4.3). The
   * read is global — no tenant filter is ever applied (Req 2.2). Results are
   * ordered deterministically by `class_id`, then `age_group`, then `code`
   * (Req 2.6), producing identical ordering across repeated identical
   * requests. An empty result set is a successful `200` empty list, never an
   * error (Req 2.3, 3.4, 4.4).
   *
   * @param query validated optional `class_id` / `age_group` filters.
   * @returns a single-page pagination envelope under the `official_color` key
   *   (Req 7.5). Prisma's camelCase fields (`classId`, `ageGroup`) are
   *   serialized to the snake_case wire contract (`class_id`, `age_group`) by
   *   the global `SnakeCaseInterceptor` (Req 2.4, 7.4).
   */
  async list(query: ListOfficialColorQueryDto) {
    const where: Prisma.OfficialColorWhereInput = {
      ...(query.class_id ? { classId: query.class_id } : {}),
      ...(query.age_group ? { ageGroup: query.age_group } : {}),
    };

    const rows = await this.prisma.officialColor.findMany({
      where,
      orderBy: [{ classId: 'asc' }, { ageGroup: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        classId: true,
        ageGroup: true,
        code: true,
        title: true,
      },
    });

    return buildEnvelope('official_color', rows);
  }
}
