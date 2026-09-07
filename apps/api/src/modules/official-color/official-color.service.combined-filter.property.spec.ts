// Feature: color-catalogs, Property 10: Combined class_id + age_group filter correctness
import fc from 'fast-check';
import { age_group } from '@avyo/types';

import { OfficialColorService } from './official-color.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { ListOfficialColorQueryDto } from './dto/list-official-color.query.dto';

/**
 * Feature: color-catalogs, Property 10 — Combined class_id + age_group filter
 * correctness.
 *
 * Validates: Requirements 4.3
 *
 * For any catalog contents, any valid UUID `class_id`, and any `age_group` in
 * `{young, adult}`, `GET /official-color?class_id=…&age_group=…` returns
 * exactly the Official_Color records matching BOTH conditions (the two filters
 * are ANDed) — and an empty list when none match (Req 4.3).
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
 * `officialColor.findMany` APPLIES the `where` clause the service constructs,
 * ANDing `where.classId` and `where.ageGroup` exactly as the real Prisma
 * client would. This keeps the property focused on the service's own ANDed
 * filter logic without a live database.
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
          // AND semantics: a row is kept only when it satisfies every present
          // condition.
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

describe('OfficialColorService.list property: combined class_id + age_group filter correctness (Property 10)', () => {
  it('returns exactly the rows matching BOTH class_id AND age_group (empty when none match)', async () => {
    // A small pool of class ids so generated rows frequently share a class,
    // making the combined (AND) match branch meaningful across runs.
    const classPoolArb = fc.array(fc.uuid({ version: 4 }), {
      minLength: 1,
      maxLength: 4,
    });

    await fc.assert(
      fc.asyncProperty(
        classPoolArb.chain((classIds) => {
          const rowArb = fc.record({
            id: fc.uuid({ version: 4 }),
            classId: fc.constantFrom(...classIds),
            ageGroup: fc.constantFrom(age_group.young, age_group.adult),
            code: fc.string({ minLength: 1, maxLength: 50 }),
            title: fc.string({ minLength: 1, maxLength: 255 }),
          });
          return fc.record({
            rows: fc.array(rowArb, { maxLength: 40 }),
            // Sometimes filter by an existing class id (likely to match some
            // rows), sometimes by a random UUID that (almost surely) matches
            // nothing — so the empty-result branch is exercised too.
            classFilter: fc.oneof(
              fc.constantFrom(...classIds),
              fc.uuid({ version: 4 }),
            ),
            ageFilter: fc.constantFrom(age_group.young, age_group.adult),
          });
        }),
        async ({ rows, classFilter, ageFilter }) => {
          const service = new OfficialColorService(fakePrisma(rows));
          const query: ListOfficialColorQueryDto = {
            class_id: classFilter,
            age_group: ageFilter,
          };

          const envelope = await service.list(query);
          const returned = envelope.data.official_color;

          // Expected subset: rows satisfying BOTH conditions (ANDed).
          const expected = rows.filter(
            (r) => r.classId === classFilter && r.ageGroup === ageFilter,
          );

          // Same multiset of ids: exactly the ANDed subset, no additions or
          // omissions (Req 4.3).
          expect([...returned].map((r) => r.id).sort()).toEqual(
            expected.map((r) => r.id).sort(),
          );

          // Every returned row satisfies BOTH filters.
          for (const r of returned) {
            expect(r.classId).toBe(classFilter);
            expect(r.ageGroup).toBe(ageFilter);
          }

          // Empty list precisely when nothing matches both conditions.
          expect(returned.length === 0).toBe(expected.length === 0);
          expect(envelope.meta.total).toBe(expected.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns an empty list when the class matches but no row has the requested age_group', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid({ version: 4 }),
        fc.constantFrom(age_group.young, age_group.adult),
        fc.array(
          fc.record({
            id: fc.uuid({ version: 4 }),
            code: fc.string({ minLength: 1, maxLength: 50 }),
            title: fc.string({ minLength: 1, maxLength: 255 }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        async (classFilter, ageFilter, partials) => {
          // Every row shares the filtered class but carries the OPPOSITE
          // age_group, so the ANDed filter must yield nothing (Req 4.3).
          const other =
            ageFilter === age_group.young ? age_group.adult : age_group.young;
          const rows: OfficialColorRow[] = partials.map((p) => ({
            ...p,
            classId: classFilter,
            ageGroup: other,
          }));

          const service = new OfficialColorService(fakePrisma(rows));
          const envelope = await service.list({
            class_id: classFilter,
            age_group: ageFilter,
          });

          expect(envelope.data.official_color).toEqual([]);
          expect(envelope.meta.total).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
