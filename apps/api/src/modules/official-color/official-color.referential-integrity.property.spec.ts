// Feature: color-catalogs, Property 14: Official-color referential integrity
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';

import {
  seedColorCatalog,
  SeedError,
  type SeedDataset,
} from '../../../prisma/seed';
import type {
  SeedColorClass,
  SeedOfficialColor,
} from '../../../prisma/seed-data/color-catalog';

/**
 * Feature: color-catalogs, Property 14 — Official-color referential integrity.
 *
 * Validates: Requirements 3.1
 *
 * For any persisted Official_Color record, its `class_id` references the `id`
 * of an existing Color_Class.
 *
 * The invariant is enforced in the database by the FK
 * `official_color.class_id → color_class.id` (onDelete: Restrict), and at the
 * logic level by `seedColorCatalog`, which resolves each official color's
 * `classCode` to a real class `id` before writing and aborts the whole run
 * (rolling back the transaction) if any reference is unresolved.
 *
 * This property models that logic level using an in-memory Prisma fake:
 * `$transaction` runs the callback against a `tx` whose `colorClass.upsert` and
 * `officialColor.upsert` are backed by `Map`s keyed on the record `id`. If the
 * callback throws, the transaction discards its buffered writes (rollback), so
 * no orphaned official color is ever persisted.
 *
 * - VALID datasets (every official color's `classCode` references an existing
 *   class) are generated and seeded; we then assert EVERY persisted
 *   `official_color.classId` exists as an `id` in the persisted `color_class`
 *   set — referential integrity holds.
 * - A DANGLING dataset (one official color references a non-existent class
 *   code) is generated and we assert `seedColorCatalog` throws and persists no
 *   orphan — the two tables are left exactly as they were before the run.
 */

/** A persisted color_class row in the fake store. */
interface ColorClassRow {
  id: string;
  name: string;
  code: string;
}

/** A persisted official_color row in the fake store. */
interface OfficialColorRow {
  id: string;
  classId: string;
  ageGroup: 'young' | 'adult';
  code: string;
  title: string;
}

/**
 * A minimal in-memory Prisma fake matching the surface `seedColorCatalog` uses:
 * an interactive `$transaction(fn)` plus `colorClass.upsert`/`officialColor.upsert`.
 *
 * Writes buffer into transaction-local Maps that are only committed to the
 * backing store when the callback resolves; if it throws, the buffered writes
 * are discarded, faithfully modelling a rollback (Req 6.6/6.7) so no orphan can
 * survive a failed run.
 */
function createPrismaFake() {
  const colorClasses = new Map<string, ColorClassRow>();
  const officialColors = new Map<string, OfficialColorRow>();

  function makeTx(
    txClasses: Map<string, ColorClassRow>,
    txColors: Map<string, OfficialColorRow>,
  ) {
    return {
      colorClass: {
        upsert: ({
          where,
          create,
          update,
        }: {
          where: { id: string };
          create: ColorClassRow;
          update: Partial<ColorClassRow>;
        }) => {
          const existing = txClasses.get(where.id);
          const next: ColorClassRow = existing
            ? { ...existing, ...update, id: where.id }
            : { ...create };
          txClasses.set(where.id, next);
          return Promise.resolve(next);
        },
      },
      officialColor: {
        upsert: ({
          where,
          create,
          update,
        }: {
          where: { id: string };
          create: OfficialColorRow;
          update: Partial<OfficialColorRow>;
        }) => {
          const existing = txColors.get(where.id);
          const next: OfficialColorRow = existing
            ? { ...existing, ...update, id: where.id }
            : { ...create };
          txColors.set(where.id, next);
          return Promise.resolve(next);
        },
      },
    };
  }

  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      // Buffer writes in transaction-local copies; only commit on success.
      const txClasses = new Map(colorClasses);
      const txColors = new Map(officialColors);
      const result = await fn(makeTx(txClasses, txColors));
      // Commit.
      colorClasses.clear();
      for (const [k, v] of txClasses) colorClasses.set(k, v);
      officialColors.clear();
      for (const [k, v] of txColors) officialColors.set(k, v);
      return result;
    },
  };

  return { prisma, colorClasses, officialColors };
}

/** Generate a non-empty set of color classes with unique ids and codes. */
const colorClassesArb: fc.Arbitrary<SeedColorClass[]> = fc
  .uniqueArray(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 50 }),
      code: fc.string({ minLength: 1, maxLength: 20 }),
    }),
    { minLength: 1, maxLength: 6, selector: (c) => c.code },
  )
  .map((classes) =>
    classes.map((c) => ({ id: randomUUID(), name: c.name, code: c.code })),
  );

/**
 * Given a set of classes, generate a set of official colors whose `classCode`
 * always references one of those classes (a VALID dataset).
 */
function validOfficialColorsArb(
  classes: SeedColorClass[],
): fc.Arbitrary<SeedOfficialColor[]> {
  const classCodes = classes.map((c) => c.code);
  return fc.array(
    fc.record({
      id: fc.constant(''), // replaced below with a fresh UUID
      classCode: fc.constantFrom(...classCodes),
      ageGroup: fc.constantFrom<'young' | 'adult'>('young', 'adult'),
      code: fc.string({ minLength: 1, maxLength: 20 }),
      title: fc.string({ minLength: 1, maxLength: 50 }),
    }),
    { maxLength: 12 },
  ).map((colors) => colors.map((c) => ({ ...c, id: randomUUID() })));
}

describe('seedColorCatalog property: official-color referential integrity (Property 14)', () => {
  it('persists no official color whose class_id is absent from the color_class set', async () => {
    await fc.assert(
      fc.asyncProperty(
        colorClassesArb.chain((classes) =>
          validOfficialColorsArb(classes).map((officialColors) => ({
            colorClasses: classes,
            officialColors,
          })),
        ),
        async (dataset: SeedDataset) => {
          const { prisma, colorClasses, officialColors } = createPrismaFake();

          await seedColorCatalog(prisma as never, dataset);

          const persistedClassIds = new Set(
            [...colorClasses.values()].map((c) => c.id),
          );

          // Referential integrity: every persisted official color's classId is
          // the id of a persisted color class (Req 3.1).
          for (const color of officialColors.values()) {
            expect(persistedClassIds.has(color.classId)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('aborts and persists no orphan when an official color references a dangling class code', async () => {
    await fc.assert(
      fc.asyncProperty(
        colorClassesArb.chain((classes) => {
          const classCodes = new Set(classes.map((c) => c.code));
          const danglingCode = fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((code) => !classCodes.has(code));
          return fc.record({
            colorClasses: fc.constant(classes),
            valid: validOfficialColorsArb(classes),
            danglingCode,
            danglingIndex: fc.nat(),
          });
        }),
        async ({ colorClasses: classes, valid, danglingCode, danglingIndex }) => {
          // Insert one official color pointing at a code no class has.
          const dangling: SeedOfficialColor = {
            id: randomUUID(),
            classCode: danglingCode,
            ageGroup: 'adult',
            code: 'dangling',
            title: 'dangling',
          };
          const officialColorsInput = [...valid];
          const at = valid.length === 0 ? 0 : danglingIndex % (valid.length + 1);
          officialColorsInput.splice(at, 0, dangling);

          const { prisma, colorClasses, officialColors } = createPrismaFake();

          let thrown: unknown;
          try {
            await seedColorCatalog(prisma as never, {
              colorClasses: classes,
              officialColors: officialColorsInput,
            });
          } catch (error) {
            thrown = error;
          }

          // The run aborts with a SeedError naming the unresolved reference.
          expect(thrown).toBeInstanceOf(SeedError);

          // Rollback: no official color persisted at all — no orphan survives.
          expect(officialColors.size).toBe(0);
          // And referential integrity trivially holds over the empty set.
          const persistedClassIds = new Set(
            [...colorClasses.values()].map((c) => c.id),
          );
          for (const color of officialColors.values()) {
            expect(persistedClassIds.has(color.classId)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
