// Feature: color-catalogs, Property 1: Color-class listing shape and completeness
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';

import { ColorClassService } from './color-class.service';
import type { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Feature: color-catalogs, Property 1 — Color-class listing shape and completeness.
 *
 * Validates: Requirements 1.1, 1.3
 *
 * For any set of Color_Class records in the catalog, `GET /color-class` (via
 * {@link ColorClassService.list}) returns exactly those records — no additions,
 * no omissions — each with a non-null UUID `id`, a non-empty `name`, and a
 * non-empty `code` (Req 1.1). An empty catalog yields an empty list, not an
 * error (Req 1.3).
 */

/** RFC 4122 version-4 UUID matcher. */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Row = { id: string; name: string; code: string };

/**
 * Build an in-memory Prisma fake whose `colorClass.findMany` honours the
 * `orderBy` and `select` clauses the service passes, mirroring the real client
 * for the pure listing logic under test (per the design testing note:
 * "in-memory Prisma fake for pure logic").
 */
function makePrismaFake(stored: Row[]): PrismaService {
  return {
    colorClass: {
      findMany: (args: {
        orderBy?: { code?: 'asc' | 'desc' };
        select?: Record<string, boolean>;
      }) => {
        let rows = [...stored];

        if (args.orderBy?.code) {
          const dir = args.orderBy.code === 'desc' ? -1 : 1;
          rows.sort((a, b) =>
            a.code < b.code ? -dir : a.code > b.code ? dir : 0,
          );
        }

        if (args.select) {
          const keys = Object.keys(args.select).filter((k) => args.select![k]);
          rows = rows.map((row) => {
            const projected: Record<string, unknown> = {};
            for (const key of keys) {
              projected[key] = (row as Record<string, unknown>)[key];
            }
            return projected as Row;
          });
        }

        return Promise.resolve(rows);
      },
    },
  } as unknown as PrismaService;
}

/** A single Color_Class row: v4 UUID id, non-empty name, non-empty code. */
const rowArb: fc.Arbitrary<Row> = fc.record({
  id: fc.constant(null).map(() => randomUUID()),
  name: fc.string({ minLength: 1, maxLength: 255 }).filter((s) => s.trim().length > 0),
  code: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
});

describe('ColorClassService.list property: listing shape and completeness (Property 1)', () => {
  it('returns exactly the stored color-class records with required non-null/non-empty fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Arbitrary set of rows with unique ids (a catalog is a set of records);
        // includes the empty set to cover Req 1.3.
        fc.uniqueArray(rowArb, {
          minLength: 0,
          maxLength: 30,
          selector: (r) => r.id,
        }),
        async (stored) => {
          const service = new ColorClassService(makePrismaFake(stored));

          const envelope = await service.list();
          const data = envelope.data.color_class;

          // Completeness: same set of ids, no additions, no omissions.
          const returnedIds = new Set(data.map((r) => r.id));
          const storedIds = new Set(stored.map((r) => r.id));
          expect(data).toHaveLength(stored.length);
          expect(returnedIds).toEqual(storedIds);

          // Each returned record matches its stored counterpart exactly and
          // satisfies the field requirements (Req 1.1).
          const storedById = new Map(stored.map((r) => [r.id, r]));
          for (const record of data) {
            expect(record.id).toMatch(UUID_V4);
            expect(record.id).not.toBeNull();
            expect(typeof record.name).toBe('string');
            expect(record.name.length).toBeGreaterThan(0);
            expect(typeof record.code).toBe('string');
            expect(record.code.length).toBeGreaterThan(0);

            expect(record).toEqual(storedById.get(record.id));
          }

          // Req 1.3: empty catalog → empty list (a successful response).
          if (stored.length === 0) {
            expect(data).toEqual([]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
