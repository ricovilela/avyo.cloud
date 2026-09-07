// Feature: color-catalogs, Property 16: Seed idempotency and convergence
import fc from 'fast-check';

import {
  seedColorCatalog,
  type SeedDataset,
} from '../../prisma/seed';

/**
 * Feature: color-catalogs, Property 16 — Seed idempotency and convergence.
 *
 * Validates: Requirements 6.1, 6.3, 6.4
 *
 * For any valid seed dataset, running the Seed_Process once and running it
 * repeatedly leave the `color_class` and `official_color` tables with the same
 * set of records — exactly the defined set — with no duplicates and no change
 * to the primary key of any previously created record.
 *
 * The test drives the exported `seedColorCatalog(prisma, dataset)` against an
 * IN-MEMORY Prisma fake whose `$transaction(cb)` invokes `cb` with a tx object,
 * and whose `colorClass.upsert` / `officialColor.upsert` are backed by Maps
 * keyed on `id` (upsert = create when the id is absent, else update — mirroring
 * the DB's stable-key convergence).
 */

interface UpsertArgs {
  where: { id: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

/**
 * A minimal in-memory model backed by a Map keyed on `id`. `upsert` creates the
 * record when its id is absent and updates it otherwise — exactly the stable
 * primary-key semantics the seed relies on for convergence (Req 6.3).
 */
function createModel(table: Map<string, Record<string, unknown>>) {
  return {
    upsert: ({ where, create, update }: UpsertArgs) => {
      const existing = table.get(where.id);
      if (existing === undefined) {
        const created = { ...create };
        table.set(where.id, created);
        return Promise.resolve(created);
      }
      const updated = { ...existing, ...update };
      table.set(where.id, updated);
      return Promise.resolve(updated);
    },
  };
}

/** Build the in-memory Prisma fake with both catalog tables. */
function createFakePrisma() {
  const colorClass = new Map<string, Record<string, unknown>>();
  const officialColor = new Map<string, Record<string, unknown>>();
  const tx = {
    colorClass: createModel(colorClass),
    officialColor: createModel(officialColor),
  };
  const prisma = {
    $transaction: <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(tx),
  };
  return { prisma, tables: { colorClass, officialColor } };
}

/**
 * Serialize a table into a stable, order-independent snapshot: records sorted by
 * `id`. Two snapshots being equal means the same SET of records with identical
 * field values and identical primary keys.
 */
function snapshot(table: Map<string, Record<string, unknown>>): string {
  const rows = Array.from(table.values()).sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  );
  return JSON.stringify(rows);
}

/** Sorted list of primary keys currently in a table. */
function primaryKeys(table: Map<string, Record<string, unknown>>): string[] {
  return Array.from(table.keys()).sort();
}

/**
 * Generate an arbitrary VALID seed dataset:
 * - color classes with unique stable UUID `id`s and unique `code`s;
 * - official colors with unique stable UUID `id`s, a `classCode` referencing an
 *   existing class `code`, an `ageGroup` in {young, adult}, and a unique
 *   (classCode, code, ageGroup) triple (mirroring the DB composite unique key).
 */
const datasetArb: fc.Arbitrary<SeedDataset> = fc
  .uniqueArray(
    fc.record({
      code: fc.string({ minLength: 1, maxLength: 20 }),
      name: fc.string({ minLength: 1, maxLength: 50 }),
    }),
    { selector: (c) => c.code, minLength: 1, maxLength: 6 },
  )
  .chain((classesRaw) =>
    fc
      .uniqueArray(fc.uuid(), {
        minLength: classesRaw.length,
        maxLength: classesRaw.length,
      })
      .map((ids) =>
        classesRaw.map((c, i) => ({
          id: ids[i]!,
          name: c.name,
          code: c.code,
        })),
      ),
  )
  .chain((colorClasses) => {
    const codes = colorClasses.map((c) => c.code);
    return fc
      .array(
        fc.record({
          classCode: fc.constantFrom(...codes),
          ageGroup: fc.constantFrom('young' as const, 'adult' as const),
          code: fc.string({ minLength: 1, maxLength: 20 }),
          title: fc.string({ minLength: 1, maxLength: 50 }),
        }),
        { maxLength: 12 },
      )
      .chain((ocRaw) => {
        // Enforce the (classCode, code, ageGroup) composite-unique invariant.
        const seen = new Set<string>();
        const deduped = ocRaw.filter((oc) => {
          const key = `${oc.classCode}\u0000${oc.code}\u0000${oc.ageGroup}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return fc
          .uniqueArray(fc.uuid(), {
            minLength: deduped.length,
            maxLength: deduped.length,
          })
          .map((ids) => ({
            colorClasses,
            officialColors: deduped.map((oc, i) => ({ id: ids[i]!, ...oc })),
          }));
      });
  });

describe('seedColorCatalog property: idempotency and convergence (Property 16)', () => {
  it('converges to exactly the defined set across repeated runs with no duplicates and stable primary keys', async () => {
    await fc.assert(
      fc.asyncProperty(datasetArb, async (dataset) => {
        const { prisma, tables } = createFakePrisma();

        // The defined set the seed must converge to.
        const classIdByCode = new Map(
          dataset.colorClasses.map((c) => [c.code, c.id]),
        );
        const expectedClassIds = dataset.colorClasses
          .map((c) => c.id)
          .sort();
        const expectedOfficialIds = dataset.officialColors
          .map((o) => o.id)
          .sort();

        // --- Run once. ---
        await seedColorCatalog(prisma as never, dataset);

        const classSnapshot1 = snapshot(tables.colorClass);
        const officialSnapshot1 = snapshot(tables.officialColor);
        const classKeys1 = primaryKeys(tables.colorClass);
        const officialKeys1 = primaryKeys(tables.officialColor);

        // After a single run the tables hold EXACTLY the defined set (Req 6.1).
        expect(classKeys1).toEqual(expectedClassIds);
        expect(officialKeys1).toEqual(expectedOfficialIds);

        // No duplicates: a Map cannot hold duplicate keys, and the record count
        // equals the number of defined records (Req 6.1, 6.3).
        expect(tables.colorClass.size).toBe(dataset.colorClasses.length);
        expect(tables.officialColor.size).toBe(dataset.officialColors.length);

        // Every official color resolved its classCode to a real class id and
        // the class_id belongs to a defined class (Req 6.2 sanity).
        for (const [, row] of tables.officialColor) {
          expect(expectedClassIds).toContain(row.classId as string);
        }
        // Each official color's stored class_id matches the resolved mapping.
        for (const oc of dataset.officialColors) {
          expect(tables.officialColor.get(oc.id)?.classId).toBe(
            classIdByCode.get(oc.classCode),
          );
        }

        // --- Run a second and a third time (repeated runs). ---
        await seedColorCatalog(prisma as never, dataset);
        await seedColorCatalog(prisma as never, dataset);

        const classSnapshot3 = snapshot(tables.colorClass);
        const officialSnapshot3 = snapshot(tables.officialColor);
        const classKeys3 = primaryKeys(tables.colorClass);
        const officialKeys3 = primaryKeys(tables.officialColor);

        // Same SET of records — exactly the defined set — after repeating
        // (Req 6.1, 6.3).
        expect(classSnapshot3).toBe(classSnapshot1);
        expect(officialSnapshot3).toBe(officialSnapshot1);

        // No new/duplicate records appeared on re-run (Req 6.3).
        expect(tables.colorClass.size).toBe(dataset.colorClasses.length);
        expect(tables.officialColor.size).toBe(dataset.officialColors.length);

        // No previously-created primary key changed across runs (Req 6.3, 6.4).
        expect(classKeys3).toEqual(classKeys1);
        expect(officialKeys3).toEqual(officialKeys1);
      }),
      { numRuns: 100 },
    );
  });
});
