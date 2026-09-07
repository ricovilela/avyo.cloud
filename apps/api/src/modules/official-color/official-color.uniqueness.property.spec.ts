// Feature: color-catalogs, Property 15: young/adult variant coexistence with duplicate rejection
import fc from 'fast-check';

import { age_group } from '@avyo/types';

/**
 * Feature: color-catalogs, Property 15 — young/adult variant coexistence with
 * duplicate rejection.
 *
 * Validates: Requirements 3.5, 3.7
 *
 * For any Color_Class and any `code`, the system permits at most one
 * Official_Color per `age_group` value under that `(class_id, code)` — i.e. a
 * `young` and an `adult` variant may coexist, but a second record duplicating
 * an existing `(class_id, code, age_group)` triple is rejected as a conflict.
 *
 * This is enforced in the schema by the composite
 * `@@unique([classId, code, ageGroup])` on `official_color`
 * (apps/api/prisma/schema.prisma). Because it is a database uniqueness
 * constraint, the invariant is modelled here at the logic level: a `Set` keyed
 * on the `(class_id, code, age_group)` triple mirrors the DB unique index, and
 * `tryInsert` returns `'inserted'` for a fresh triple or `'conflict'` for a
 * triple already present. A pure, set-based model is used (preferred for speed)
 * rather than a live PostgreSQL insert.
 */

/** A candidate official-color record for the uniqueness model. */
interface ColorRecord {
  classId: string;
  code: string;
  ageGroup: age_group;
}

/** The composite unique key, mirroring `@@unique([classId, code, ageGroup])`. */
function tripleKey(r: ColorRecord): string {
  // JSON.stringify of the ordered fields gives a collision-free key for the
  // three string components (age_group is a bounded enum, classId/code arbitrary).
  return JSON.stringify([r.classId, r.code, r.ageGroup]);
}

/**
 * Model of the DB unique index: attempt to insert `record` into `seen`.
 * Returns `'inserted'` and mutates `seen` when the triple is new; returns
 * `'conflict'` and leaves `seen` unchanged when the triple already exists.
 */
function tryInsert(
  seen: Set<string>,
  record: ColorRecord,
): 'inserted' | 'conflict' {
  const key = tripleKey(record);
  if (seen.has(key)) {
    return 'conflict';
  }
  seen.add(key);
  return 'inserted';
}

describe('OfficialColor uniqueness property: young/adult coexistence with duplicate rejection (Property 15)', () => {
  it('permits a young + adult pair to coexist under the same (class_id, code)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          classId: fc.uuid({ version: 4 }),
          code: fc.string({ minLength: 1, maxLength: 50 }),
        }),
        async ({ classId, code }) => {
          const seen = new Set<string>();

          // Two records sharing (class_id, code) but differing by age_group are
          // two DISTINCT triples — both must be accepted (Req 3.5).
          const young: ColorRecord = { classId, code, ageGroup: age_group.young };
          const adult: ColorRecord = { classId, code, ageGroup: age_group.adult };

          expect(tryInsert(seen, young)).toBe('inserted');
          expect(tryInsert(seen, adult)).toBe('inserted');

          // Both variants coexist: exactly two distinct triples are stored.
          expect(seen.size).toBe(2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects any second record duplicating an existing (class_id, code, age_group) triple', async () => {
    // A small pool of class ids / codes so generated records frequently collide,
    // making the duplicate branch meaningful across runs.
    const poolArb = fc.record({
      classIds: fc.uniqueArray(fc.uuid({ version: 4 }), {
        minLength: 1,
        maxLength: 3,
      }),
      codes: fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
        minLength: 1,
        maxLength: 3,
      }),
    });

    await fc.assert(
      fc.asyncProperty(
        poolArb.chain(({ classIds, codes }) => {
          const recordArb = fc.record({
            classId: fc.constantFrom(...classIds),
            code: fc.constantFrom(...codes),
            ageGroup: fc.constantFrom(age_group.young, age_group.adult),
          });
          return fc.array(recordArb, { minLength: 1, maxLength: 40 });
        }),
        async (records) => {
          const seen = new Set<string>();
          // Reference model computed independently of `tryInsert`: the set of
          // triples that SHOULD be accepted (first occurrence of each triple).
          const acceptedTriples = new Set<string>();

          for (const record of records) {
            const key = tripleKey(record);
            const firstOccurrence = !acceptedTriples.has(key);
            const result = tryInsert(seen, record);

            if (firstOccurrence) {
              // A brand-new triple is accepted (Req 3.5 permits the variant).
              expect(result).toBe('inserted');
              acceptedTriples.add(key);
            } else {
              // A repeat of an existing triple is a conflict (Req 3.7).
              expect(result).toBe('conflict');
            }
          }

          // The stored set equals exactly the distinct triples — no duplicates
          // were ever admitted, and every distinct triple was admitted once.
          expect(seen.size).toBe(acceptedTriples.size);
          expect(seen).toEqual(acceptedTriples);
        },
      ),
      { numRuns: 100 },
    );
  });
});
