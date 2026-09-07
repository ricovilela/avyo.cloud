// Feature: color-catalogs, Property 5: Deterministic official-color ordering
import fc from 'fast-check';
import { age_group } from '@avyo/types';

import { OfficialColorService } from './official-color.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { ListOfficialColorQueryDto } from './dto/list-official-color.query.dto';

/**
 * Feature: color-catalogs, Property 5 — Deterministic official-color ordering.
 *
 * Validates: Requirements 2.6
 *
 * For any set of Official_Color records, `GET /official-color` (via
 * {@link OfficialColorService.list}) returns them sorted ascending by
 * `class_id`, then `age_group`, then `code`, and repeated identical requests
 * produce byte-for-byte identical ordering.
 *
 * The service is driven by an in-memory Prisma fake whose
 * `officialColor.findMany` HONORS the multi-key `orderBy` the service passes.
 * Ordering models the native PostgreSQL semantics exactly:
 * - `class_id`: text / Unicode code-point comparison.
 * - `age_group`: NATIVE ENUM DECLARATION ORDER — `young` before `adult`. This
 *   is NOT alphabetical (alphabetically `'adult'` < `'young'`), so the fake
 *   uses an explicit rank (`young = 0`, `adult = 1`) to match Postgres.
 * - `code`: text / Unicode code-point comparison.
 */

/** Native enum declaration order rank: young precedes adult (Req 2.6). */
const AGE_GROUP_RANK: Record<string, number> = {
  [age_group.young]: 0,
  [age_group.adult]: 1,
};

interface FakeRow {
  id: string;
  classId: string;
  ageGroup: age_group;
  code: string;
  title: string;
}

/** Code-point (byte) comparison of two strings, matching a `C` collation. */
function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic tri-key comparator mirroring the service's
 * `orderBy: [{ classId }, { ageGroup }, { code }]`. `ageGroup` is compared by
 * declaration-order rank, never alphabetically.
 */
interface TriKeyRow {
  classId: string;
  ageGroup: string;
  code: string;
}

function compareTriKey(a: TriKeyRow, b: TriKeyRow): number {
  const byClass = compareCodePoint(a.classId, b.classId);
  if (byClass !== 0) return byClass;
  const byAge =
    (AGE_GROUP_RANK[a.ageGroup] ?? 0) - (AGE_GROUP_RANK[b.ageGroup] ?? 0);
  if (byAge !== 0) return byAge;
  return compareCodePoint(a.code, b.code);
}

type OrderByKey = { classId?: 'asc' | 'desc' } | { ageGroup?: 'asc' | 'desc' } | { code?: 'asc' | 'desc' };

/**
 * Build a fake PrismaService whose `officialColor.findMany` honors the
 * multi-key `orderBy` the service supplies, ordering `age_group` by native
 * enum declaration order rather than alphabetically.
 */
function makeFakePrisma(rows: FakeRow[]): PrismaService {
  return {
    officialColor: {
      findMany: (args: { orderBy?: OrderByKey[] }) => {
        const orderBy = args.orderBy ?? [];
        const sorted = [...rows].sort((a, b) => {
          for (const key of orderBy) {
            const [field] = Object.keys(key) as (keyof FakeRow)[];
            if (field === undefined) continue;
            let cmp = 0;
            if (field === 'ageGroup') {
              cmp =
                (AGE_GROUP_RANK[a.ageGroup] ?? 0) -
                (AGE_GROUP_RANK[b.ageGroup] ?? 0);
            } else {
              cmp = compareCodePoint(
                String(a[field]),
                String(b[field]),
              );
            }
            if (cmp !== 0) return cmp;
          }
          return 0;
        });
        return Promise.resolve(
          sorted.map((r) => ({
            id: r.id,
            classId: r.classId,
            ageGroup: r.ageGroup,
            code: r.code,
            title: r.title,
          })),
        );
      },
    },
  } as unknown as PrismaService;
}

describe('OfficialColorService.list property: deterministic official-color ordering (Property 5)', () => {
  const nonEmptyString = fc
    .string({ minLength: 1, maxLength: 12 })
    .filter((s) => s.length > 0);

  // A small class-id alphabet forces frequent ties on class_id so the
  // secondary (age_group) and tertiary (code) keys are exercised.
  const classIdArb = fc.constantFrom('c-a', 'c-b', 'c-c', 'c-d');
  const ageGroupArb = fc.constantFrom(age_group.young, age_group.adult);

  const rowArb: fc.Arbitrary<FakeRow> = fc.record({
    id: fc.uuid(),
    classId: classIdArb,
    ageGroup: ageGroupArb,
    code: nonEmptyString,
    title: nonEmptyString,
  });

  it('returns rows in ascending class_id, then age_group (young<adult), then code order, identically across repeated requests', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(rowArb, { maxLength: 40 }),
        async (rows) => {
          const service = new OfficialColorService(makeFakePrisma(rows));
          const query = {} as ListOfficialColorQueryDto;

          const first = await service.list(query);
          const second = await service.list(query);

          const firstRows = first.data.official_color;
          const secondRows = second.data.official_color;

          // Completeness: every input row is returned (no additions/omissions).
          expect(firstRows).toHaveLength(rows.length);

          // Expected tri-key ordering, modelling age_group by declaration order.
          const expected = [...rows].sort(compareTriKey);

          for (let i = 0; i < expected.length; i++) {
            const actual = firstRows[i];
            const want = expected[i];
            expect(actual).toBeDefined();
            expect(want).toBeDefined();
            expect(actual!.id).toBe(want!.id);
            expect(actual!.classId).toBe(want!.classId);
            expect(actual!.ageGroup).toBe(want!.ageGroup);
            expect(actual!.code).toBe(want!.code);
          }

          // Adjacent pairs are non-decreasing under the tri-key comparator.
          for (let i = 1; i < firstRows.length; i++) {
            const prev = firstRows[i - 1];
            const curr = firstRows[i];
            expect(prev).toBeDefined();
            expect(curr).toBeDefined();
            expect(compareTriKey(prev!, curr!)).toBeLessThanOrEqual(0);
          }

          // Determinism: repeated identical requests produce identical ordering.
          expect(secondRows.map((r) => r.id)).toEqual(firstRows.map((r) => r.id));
        },
      ),
      { numRuns: 100 },
    );
  });
});
