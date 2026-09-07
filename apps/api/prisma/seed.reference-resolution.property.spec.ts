// Feature: color-catalogs, Property 17: Seed reference resolution and age_group validity
import type { PrismaClient } from "@prisma/client";
import fc from "fast-check";

import { seedColorCatalog, type SeedDataset } from "./seed";

/**
 * Feature: color-catalogs, Property 17 — Seed reference resolution and
 * age_group validity.
 *
 * Validates: Requirements 6.2, 6.5
 *
 * For any VALID seed dataset, every Official_Color the Seed_Process creates has
 * a `class_id` equal to the `id` of a Color_Class the process already created
 * (resolved correctly from its `classCode`), and an `age_group` equal to
 * exactly `young` or `adult`.
 *
 * The seed logic is exercised through a lightweight in-memory Prisma fake: a
 * `$transaction` that invokes its callback with a `tx` whose
 * `colorClass.upsert` / `officialColor.upsert` are backed by `Map`s keyed on
 * the record `id`. This captures exactly what the seed persists so the two
 * invariants can be asserted against the resulting state.
 */

/** A persisted `color_class` row as captured by the fake. */
interface FakeColorClassRow {
  id: string;
  name: string;
  code: string;
}

/** A persisted `official_color` row as captured by the fake. */
interface FakeOfficialColorRow {
  id: string;
  classId: string;
  ageGroup: string;
  code: string;
  title: string;
}

/**
 * Build an in-memory Prisma fake exposing just the surface the seed needs:
 * `$transaction(fn)` runs `fn(tx)` where `tx.colorClass.upsert` and
 * `tx.officialColor.upsert` create-or-update a row in a backing `Map` keyed by
 * `where.id`. Returns the client plus the two backing maps for assertions.
 */
function buildFakePrisma(): {
  prisma: Pick<PrismaClient, "$transaction">;
  colorClasses: Map<string, FakeColorClassRow>;
  officialColors: Map<string, FakeOfficialColorRow>;
} {
  const colorClasses = new Map<string, FakeColorClassRow>();
  const officialColors = new Map<string, FakeOfficialColorRow>();

  const tx = {
    colorClass: {
      upsert(args: {
        where: { id: string };
        create: FakeColorClassRow;
        update: Omit<FakeColorClassRow, "id">;
      }) {
        const existing = colorClasses.get(args.where.id);
        const row: FakeColorClassRow = existing
          ? { ...existing, ...args.update }
          : { ...args.create };
        colorClasses.set(args.where.id, row);
        return Promise.resolve(row);
      },
    },
    officialColor: {
      upsert(args: {
        where: { id: string };
        create: FakeOfficialColorRow;
        update: Omit<FakeOfficialColorRow, "id">;
      }) {
        const existing = officialColors.get(args.where.id);
        const row: FakeOfficialColorRow = existing
          ? { ...existing, ...args.update }
          : { ...args.create };
        officialColors.set(args.where.id, row);
        return Promise.resolve(row);
      },
    },
  };

  const prisma = {
    $transaction: <T>(fn: (client: typeof tx) => Promise<T>): Promise<T> =>
      fn(tx),
  } as unknown as Pick<PrismaClient, "$transaction">;

  return { prisma, colorClasses, officialColors };
}

/**
 * Arbitrary VALID seed dataset:
 * - color classes have unique `code`s and unique `id`s;
 * - every official color's `classCode` references an existing class code;
 * - every official color has a unique `id` and `ageGroup ∈ {young, adult}`.
 */
const validDatasetArb: fc.Arbitrary<SeedDataset> = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 20 }), {
    minLength: 1,
    maxLength: 8,
  })
  .chain((classCodes) =>
    fc
      .record({
        classIds: fc.uniqueArray(fc.uuid({ version: 4 }), {
          minLength: classCodes.length,
          maxLength: classCodes.length,
        }),
        classNames: fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
          minLength: classCodes.length,
          maxLength: classCodes.length,
        }),
        officials: fc.uniqueArray(
          fc.record({
            id: fc.uuid({ version: 4 }),
            classCode: fc.constantFrom(...classCodes),
            ageGroup: fc.constantFrom("young" as const, "adult" as const),
            code: fc.string({ minLength: 1, maxLength: 20 }),
            title: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          { selector: (o) => o.id, maxLength: 12 },
        ),
      })
      .map(
        ({ classIds, classNames, officials }): SeedDataset => ({
          colorClasses: classCodes.map((code, i) => ({
            id: classIds[i]!,
            name: classNames[i]!,
            code,
          })),
          officialColors: officials,
        }),
      ),
  );

describe("seedColorCatalog property: reference resolution and age_group validity (Property 17)", () => {
  it("resolves every official color's class_id to a seeded color class id and keeps age_group in {young, adult}", async () => {
    await fc.assert(
      fc.asyncProperty(validDatasetArb, async (dataset) => {
        const { prisma, colorClasses, officialColors } = buildFakePrisma();

        await seedColorCatalog(prisma, dataset);

        // Expected classCode → id mapping straight from the authored dataset.
        const expectedClassIdByCode = new Map(
          dataset.colorClasses.map((c) => [c.code, c.id]),
        );
        // The set of class ids the process actually persisted.
        const persistedClassIds = new Set(
          [...colorClasses.values()].map((c) => c.id),
        );

        // Every authored official color must have been persisted.
        expect(officialColors.size).toBe(dataset.officialColors.length);

        for (const official of dataset.officialColors) {
          const persisted = officialColors.get(official.id);
          expect(persisted).toBeDefined();
          if (persisted === undefined) {
            continue;
          }

          // Req 6.2: class_id resolved correctly from classCode ...
          const expectedClassId = expectedClassIdByCode.get(
            official.classCode,
          );
          expect(persisted.classId).toBe(expectedClassId);
          // ... and it is the id of a color class the process created.
          expect(persistedClassIds.has(persisted.classId)).toBe(true);

          // Req 6.5: age_group is exactly young or adult.
          expect(["young", "adult"]).toContain(persisted.ageGroup);
        }
      }),
      { numRuns: 100 },
    );
  });
});
