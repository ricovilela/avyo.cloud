// Feature: color-catalogs, Property 4: Official-color listing shape and field bounds
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';

import { OfficialColorService } from './official-color.service';
import type { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Feature: color-catalogs, Property 4 — Official-color listing shape and field
 * bounds.
 *
 * Validates: Requirements 2.1, 2.3, 2.5
 *
 * For any set of Official_Color records, `GET /official-color` (via
 * `OfficialColorService.list`) returns exactly those records — no additions,
 * no omissions — each carrying a non-null version-4 UUID `id`, a version-4
 * UUID `class_id`, an `age_group` equal to exactly `young` or `adult`, a
 * non-empty `code` of at most 50 characters, and a non-empty `title` of at
 * most 255 characters (Req 2.1, 2.5). An empty catalog yields a successful
 * empty list rather than an error (Req 2.3).
 */

/** RFC 4122 version-4 UUID matcher (version nibble 4, variant 8/9/a/b). */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A single stored official-color row as the service `select`s it. */
interface OfficialColorRow {
  id: string;
  classId: string;
  ageGroup: 'young' | 'adult';
  code: string;
  title: string;
}

/** Non-empty `code`, at most 50 chars (Req 2.1). */
const codeArb = fc.string({ minLength: 1, maxLength: 50 });
/** Non-empty `title`, at most 255 chars (Req 2.1). */
const titleArb = fc.string({ minLength: 1, maxLength: 255 });

/** An arbitrary official-color row within the Req 2.1/2.5 field bounds. */
const rowArb: fc.Arbitrary<OfficialColorRow> = fc.record({
  id: fc.uuid({ version: 4 }),
  classId: fc.uuid({ version: 4 }),
  ageGroup: fc.constantFrom<'young' | 'adult'>('young', 'adult'),
  code: codeArb,
  title: titleArb,
});

/**
 * In-memory Prisma fake: `officialColor.findMany` returns the generated rows
 * verbatim. `list({})` applies no filters, so the fake mirrors the "return
 * exactly the catalog" behaviour without a database.
 */
function fakePrisma(rows: OfficialColorRow[]): PrismaService {
  return {
    officialColor: {
      findMany: () => Promise.resolve(rows),
    },
  } as unknown as PrismaService;
}

describe('OfficialColorService.list property: listing shape and field bounds (Property 4)', () => {
  it('returns exactly the catalog records, each within the UUID/age_group/code/title bounds', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(rowArb, { minLength: 0, maxLength: 30 }),
        async (rows) => {
          const service = new OfficialColorService(fakePrisma(rows));

          const envelope = await service.list({});
          const returned = envelope.data.official_color;

          // Req 2.1 / 2.3: exactly those records, no additions or omissions.
          expect(returned).toHaveLength(rows.length);
          expect(returned).toEqual(rows);

          for (const record of returned) {
            // Req 2.1: non-null version-4 UUID id.
            expect(record.id).not.toBeNull();
            expect(record.id).toMatch(UUID_V4);

            // Req 2.1: UUID class_id.
            expect(record.classId).toMatch(UUID_V4);

            // Req 2.5: age_group is exactly `young` or `adult`.
            expect(['young', 'adult']).toContain(record.ageGroup);

            // Req 2.1: non-empty code of at most 50 chars.
            expect(record.code.length).toBeGreaterThanOrEqual(1);
            expect(record.code.length).toBeLessThanOrEqual(50);

            // Req 2.1: non-empty title of at most 255 chars.
            expect(record.title.length).toBeGreaterThanOrEqual(1);
            expect(record.title.length).toBeLessThanOrEqual(255);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns a successful empty list for an empty catalog (Req 2.3)', async () => {
    const service = new OfficialColorService(fakePrisma([]));

    const envelope = await service.list({});

    expect(envelope.data.official_color).toEqual([]);
    expect(envelope.meta.total).toBe(0);
  });
});
