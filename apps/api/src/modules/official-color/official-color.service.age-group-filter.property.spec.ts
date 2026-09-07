// Feature: color-catalogs, Property 9: age_group filter correctness
import fc from 'fast-check';
import { age_group } from '@avyo/types';

import { OfficialColorService } from './official-color.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { ListOfficialColorQueryDto } from './dto/list-official-color.query.dto';

/**
 * Feature: color-catalogs, Property 9 — age_group filter correctness.
 *
 * Validates: Requirements 4.1, 4.4
 *
 * For any catalog contents and any `age_group` value equal to `young` or
 * `adult`, `GET /official-color?age_group=…` returns exactly the Official_Color
 * records whose `age_group` equals that value (Req 4.1) — and an empty list
 * when none match (Req 4.4).
 */

/** A stored `official_color` row as the service `select`s it (camelCase). */
interface OfficialColorRow {
  id: string;
  classId: string;
  ageGroup: age_group;
  code: string;
  title: string;
}

/**
 * Builds an in-memory {@link PrismaService} fake whose
 * `officialColor.findMany` APPLIES the `where` clause the service constructs —
 * filtering by `ageGroup` (and `classId`) when present — exactly as the real
 * Prisma client would. This keeps the property focused on the service's filter
 * logic without a live database.
 */
function fakePrisma(rows: OfficialColorRow[]): PrismaService {
  return {
    officialColor: {
      findMany: (args: {
        where?: { classId?: string; ageGroup?: age_group };
        select?: Record<string, boolean>;
      }) => {
        const where = args.where ?? {};
        const filtered = rows.filter((row) => {
          if (where.classId !== undefined && row.classId !== where.classId) {
            return false;
          }
          if (where.ageGroup !== undefined && row.ageGroup !== where.ageGroup) {
            return false;
          }
          return true;
        });
        return Promise.resolve(filtered);
      },
    },
  } as unknown as PrismaService;
}

/** Arbitrary official-color row generator. */
const rowArb: fc.Arbitrary<OfficialColorRow> = fc.record({
  id: fc.uuid(),
  classId: fc.uuid(),
  ageGroup: fc.constantFrom(age_group.young, age_group.adult),
  code: fc.string({ minLength: 1, maxLength: 50 }),
  title: fc.string({ minLength: 1, maxLength: 255 }),
});

describe('OfficialColorService.list property: age_group filter correctness (Property 9)', () => {
  it('returns exactly the rows whose age_group equals the filter (empty when none match)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(rowArb, { maxLength: 50 }),
        fc.constantFrom(age_group.young, age_group.adult),
        async (rows, filter) => {
          const service = new OfficialColorService(fakePrisma(rows));

          const query: ListOfficialColorQueryDto = { age_group: filter };
          const envelope = await service.list(query);

          const returned = envelope.data.official_color;
          const expected = rows.filter((row) => row.ageGroup === filter);

          // Req 4.1: every returned record matches the requested age_group.
          for (const record of returned) {
            expect(record.ageGroup).toBe(filter);
          }

          // Req 4.1 / 4.4: the returned set is exactly the matching subset
          // (by id) — no additions, no omissions, empty when none match.
          expect(new Set(returned.map((r) => r.id))).toEqual(
            new Set(expected.map((r) => r.id)),
          );
          expect(returned).toHaveLength(expected.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns an empty list when no row has the filtered age_group (Req 4.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(age_group.young, age_group.adult),
        fc.array(
          fc.record({
            id: fc.uuid(),
            classId: fc.uuid(),
            code: fc.string({ minLength: 1, maxLength: 50 }),
            title: fc.string({ minLength: 1, maxLength: 255 }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        async (filter, partials) => {
          // Force every row to the OPPOSITE age_group so none match the filter.
          const other =
            filter === age_group.young ? age_group.adult : age_group.young;
          const rows: OfficialColorRow[] = partials.map((p) => ({
            ...p,
            ageGroup: other,
          }));

          const service = new OfficialColorService(fakePrisma(rows));
          const envelope = await service.list({ age_group: filter });

          expect(envelope.data.official_color).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
