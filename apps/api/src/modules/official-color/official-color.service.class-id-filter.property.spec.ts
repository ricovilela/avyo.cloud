// Feature: color-catalogs, Property 8: class_id filter correctness
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';

import { OfficialColorService } from './official-color.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { ListOfficialColorQueryDto } from './dto/list-official-color.query.dto';

/**
 * Feature: color-catalogs, Property 8 — class_id filter correctness.
 *
 * Validates: Requirements 3.2, 3.4
 *
 * For any catalog contents and any valid UUID supplied as `class_id`,
 * `GET /official-color?class_id=…` returns exactly the Official_Color records
 * whose `class_id` equals that value — and an empty list when none match,
 * including when the UUID matches no class (Req 3.2, 3.4).
 */

/** A stored `official_color` row as the service `select`s it. */
interface Row {
  id: string;
  classId: string;
  ageGroup: 'young' | 'adult';
  code: string;
  title: string;
}

/**
 * Build an in-memory Prisma fake whose `officialColor.findMany` APPLIES the
 * `where` clause the service constructs, filtering rows by `classId` when
 * `where.classId` is present. This mirrors real Prisma semantics for the
 * `class_id` filter so the property exercises the service's own filter logic.
 */
function fakePrisma(rows: Row[]): PrismaService {
  return {
    officialColor: {
      findMany: (args: {
        where?: { classId?: string; ageGroup?: 'young' | 'adult' };
      }) => {
        const where = args.where ?? {};
        const filtered = rows.filter((r) => {
          if (where.classId !== undefined && r.classId !== where.classId) {
            return false;
          }
          if (where.ageGroup !== undefined && r.ageGroup !== where.ageGroup) {
            return false;
          }
          return true;
        });
        return Promise.resolve(filtered);
      },
    },
  } as unknown as PrismaService;
}

describe('OfficialColorService.list property: class_id filter correctness (Property 8)', () => {
  it('returns exactly the rows whose class_id equals the filter (empty when none match)', async () => {
    // A small pool of class ids so generated rows frequently share a class,
    // making the "matching" branch meaningful across runs.
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
            ageGroup: fc.constantFrom<'young' | 'adult'>('young', 'adult'),
            code: fc.string({ minLength: 1, maxLength: 50 }),
            title: fc.string({ minLength: 1, maxLength: 255 }),
          });
          return fc.record({
            rows: fc.array(rowArb, { maxLength: 30 }),
            // Sometimes filter by an existing class id, sometimes by a random
            // UUID that (almost surely) matches nothing.
            filter: fc.oneof(
              fc.constantFrom(...classIds),
              fc.uuid({ version: 4 }),
            ),
          });
        }),
        async ({ rows, filter }) => {
          const service = new OfficialColorService(fakePrisma(rows));
          const query = { class_id: filter } as ListOfficialColorQueryDto;

          const envelope = await service.list(query);
          const returned = envelope.data.official_color;

          const expected = rows.filter((r) => r.classId === filter);

          // Same multiset of ids: exactly the subset with classId === filter.
          expect([...returned].map((r) => r.id).sort()).toEqual(
            expected.map((r) => r.id).sort(),
          );
          // Every returned row actually matches the filter.
          for (const r of returned) {
            expect(r.classId).toBe(filter);
          }
          // Empty list precisely when nothing matches (Req 3.4).
          expect(returned.length === 0).toBe(expected.length === 0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns an empty list when the class_id matches no existing class', async () => {
    const rowArb = fc.record({
      id: fc.uuid({ version: 4 }),
      classId: fc.uuid({ version: 4 }),
      ageGroup: fc.constantFrom<'young' | 'adult'>('young', 'adult'),
      code: fc.string({ minLength: 1, maxLength: 50 }),
      title: fc.string({ minLength: 1, maxLength: 255 }),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(rowArb, { maxLength: 20 }),
        async (rows) => {
          // A fresh UUID not present among the rows' class ids.
          let missing = randomUUID();
          const classIds = new Set(rows.map((r) => r.classId));
          while (classIds.has(missing)) {
            missing = randomUUID();
          }

          const service = new OfficialColorService(fakePrisma(rows));
          const query = { class_id: missing } as ListOfficialColorQueryDto;

          const envelope = await service.list(query);

          expect(envelope.data.official_color).toEqual([]);
          expect(envelope.meta.total).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
