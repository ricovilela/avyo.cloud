// Feature: color-catalogs, Property 3: Deterministic color-class ordering
import fc from 'fast-check';

import { ColorClassService } from './color-class.service';
import type { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Feature: color-catalogs, Property 3 — Deterministic color-class ordering.
 *
 * Validates: Requirements 1.5
 *
 * For any set of Color_Class records, `GET /color-class` (backed by
 * {@link ColorClassService.list}) returns them sorted by `code` in ascending
 * Unicode-code-point order, and repeated identical requests produce
 * byte-for-byte identical ordering.
 *
 * Modeling choice — code-point ordering: the service delegates sorting to
 * `prisma.colorClass.findMany({ orderBy: { code: 'asc' } })`, which in
 * production is made code-point-stable by the `C` collation declared on the
 * `color_class.code` column (see design "Ordering note"). Here the in-memory
 * Prisma fake HONORS the `orderBy` argument by sorting rows on `code` with the
 * JavaScript `<` / `>` operators. String comparison via `<`/`>` in JS compares
 * by UTF-16 code unit, which is exactly the byte/code-point order the `C`
 * collation produces — so the fake faithfully models the database's ordering
 * guarantee. To keep the model exact (UTF-16 code units == code points) the
 * generated `code` strings are drawn from the Basic Multilingual Plane below
 * the surrogate range, where one code unit equals one code point.
 */

/** A Color_Class row as stored/selected by the service. */
interface ColorClassRow {
  id: string;
  name: string;
  code: string;
}

/**
 * Compare two `code` strings the way the `C` collation / code-point order does.
 * `<` / `>` on strings compares by UTF-16 code unit; for BMP-below-surrogate
 * code units this equals code-point order. Ties (equal codes) preserve input
 * order to stay a stable, deterministic total order.
 */
function byCodePoint(a: ColorClassRow, b: ColorClassRow): number {
  if (a.code < b.code) return -1;
  if (a.code > b.code) return 1;
  return 0;
}

/**
 * Build a minimal in-memory {@link PrismaService} whose `colorClass.findMany`
 * HONORS the `orderBy: { code: 'asc' }` argument by sorting the seeded rows
 * with {@link byCodePoint} and projecting the requested `select` fields. Any
 * ordering direction other than `code: 'asc'` is rejected so the test only
 * models the contract the service actually asks for.
 */
function makePrismaFake(rows: ColorClassRow[]): PrismaService {
  return {
    colorClass: {
      findMany: (args: {
        orderBy?: { code?: 'asc' | 'desc' };
        select?: Record<string, boolean>;
      }) => {
        // The service must ask for ascending code ordering (Req 1.5).
        if (args.orderBy?.code !== 'asc') {
          throw new Error(
            `unexpected orderBy: ${JSON.stringify(args.orderBy)}`,
          );
        }
        const sorted = [...rows].sort(byCodePoint).map((r) => ({
          id: r.id,
          name: r.name,
          code: r.code,
        }));
        return Promise.resolve(sorted);
      },
    },
  } as unknown as PrismaService;
}

/**
 * Generate a set of Color_Class rows with varied `code` strings. Codes are
 * drawn from BMP characters below the surrogate range (U+0020..U+D7FF) so
 * UTF-16 code-unit order equals code-point order, keeping the model exact.
 * `code` values may repeat across rows to exercise tie handling; each row's
 * `id` is unique so identity is unambiguous.
 */
const codeArb = fc.string({
  minLength: 1,
  maxLength: 12,
  unit: fc.integer({ min: 0x20, max: 0xd7ff }).map((c) => String.fromCharCode(c)),
});

const rowsArb: fc.Arbitrary<ColorClassRow[]> = fc
  .array(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 20 }),
      code: codeArb,
    }),
    { maxLength: 40 },
  )
  .map((partials) =>
    partials.map((p, i) => ({ id: `id-${i}`, name: p.name, code: p.code })),
  );

describe('ColorClassService.list property: deterministic ordering (Property 3)', () => {
  it('returns color classes sorted by code in ascending code-point order, identically across repeated calls', async () => {
    await fc.assert(
      fc.asyncProperty(rowsArb, async (rows) => {
        const service = new ColorClassService(makePrismaFake(rows));

        const first = await service.list();
        const second = await service.list();

        const firstCodes = first.data.color_class.map((r) => r.code);

        // Ordered by code ascending in code-point order: each adjacent pair is
        // non-decreasing under the same code-unit comparison the C collation
        // provides.
        for (let i = 1; i < firstCodes.length; i++) {
          const prev = firstCodes[i - 1];
          const curr = firstCodes[i];
          expect(prev !== undefined && curr !== undefined && prev <= curr).toBe(
            true,
          );
        }

        // The returned ordering equals an independent code-point sort of the
        // exact input set (no additions, omissions, or reordering beyond sort).
        const expected = [...rows].sort(byCodePoint).map((r) => r.code);
        expect(firstCodes).toEqual(expected);

        // Deterministic: two identical requests yield byte-for-byte identical
        // ordering.
        expect(JSON.stringify(second.data.color_class)).toBe(
          JSON.stringify(first.data.color_class),
        );
      }),
      { numRuns: 100 },
    );
  });
});
