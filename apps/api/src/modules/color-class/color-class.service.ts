import { Injectable } from '@nestjs/common';
import type { ColorClass, Pagination_Envelope } from '@avyo/types';

import { PrismaService } from '../../common/prisma/prisma.service';
import { buildEnvelope } from '../../common/pagination/build-envelope';

/**
 * Read-only service backing `GET /color-class`.
 *
 * Color_Class is a GLOBAL/official catalog: it carries no `user_id` and is
 * shared identically across every tenant. Consequently {@link list} applies
 * **no `user_id`/tenant filter** — every authenticated, verified user receives
 * the identical set of records (Req 1.2).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.5, 7.5
 */
@Injectable()
export class ColorClassService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List every Color_Class in the global catalog (Req 1.1–1.3, 1.5, 7.5).
   *
   * Global read: no `user_id`/tenant filter is ever applied, so all
   * authenticated users see the same records (Req 1.2). Records are ordered by
   * `code` ascending for deterministic, byte-for-byte-stable ordering across
   * repeated requests (Req 1.5; code-point stability is enforced at the column
   * level via the `C` collation on `color_class.code`). Only the public wire
   * fields `id`, `name`, and `code` are selected (Req 1.1). The rows are wrapped
   * in a single-page {@link Pagination_Envelope} under the `color_class` key,
   * yielding an empty list — not an error — when the catalog is empty
   * (Req 1.3, 7.5).
   *
   * @returns The pagination envelope holding the ordered Color_Class records.
   */
  async list(): Promise<Pagination_Envelope<{ color_class: ColorClass[] }>> {
    const rows = await this.prisma.colorClass.findMany({
      orderBy: { code: 'asc' },
      select: { id: true, name: true, code: true },
    });

    return buildEnvelope('color_class', rows);
  }
}
