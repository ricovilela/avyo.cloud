// Feature: color-catalogs, Property 18: Seed atomic rollback on failure
import fc from "fast-check";

import { seedColorCatalog, SeedError, type SeedDataset } from "./seed";
import type {
  SeedColorClass,
  SeedOfficialColor,
} from "./seed-data/color-catalog";

/**
 * Feature: color-catalogs, Property 18 — Seed atomic rollback on failure.
 *
 * Validates: Requirements 6.6, 6.7
 *
 * For any seed dataset containing an official color whose class reference
 * cannot be resolved (Req 6.6), or for any run in which a persistence operation
 * fails mid-run (Req 6.7), `seedColorCatalog` aborts and leaves BOTH tables in
 * exactly the state they held before the run began, and the thrown error names
 * the offending record / failed operation.
 *
 * The seed runs all writes inside a single interactive `prisma.$transaction`.
 * This test drives it with an in-memory Prisma fake that MODELS transactional
 * rollback: `$transaction(cb)` snapshots the backing Maps before invoking `cb`,
 * and if `cb` throws it RESTORES the snapshot (returning the tables to their
 * pre-run state) before re-throwing. `colorClass.upsert` / `officialColor.upsert`
 * mutate those Maps, exactly as a real transactional client would.
 */

interface ColorClassRow {
  id: string;
  name: string;
  code: string;
}

interface OfficialColorRow {
  id: string;
  classId: string;
  ageGroup: "young" | "adult";
  code: string;
  title: string;
}

type UpsertArgs<TCreate, TUpdate> = {
  where: { id: string };
  create: TCreate;
  update: TUpdate;
};

/**
 * An in-memory Prisma fake backed by two Maps. `$transaction` provides the
 * atomicity contract the seed relies on: snapshot → run → (on throw) restore.
 *
 * @param failOnOfficialUpsert when set, `officialColor.upsert` throws a
 *   simulated DB error on the call whose record `id` matches, letting us
 *   exercise the mid-run persistence-failure path (Req 6.7).
 */
function makeFakePrisma(options?: {
  seedClasses?: ColorClassRow[];
  seedOfficials?: OfficialColorRow[];
  failOnOfficialUpsert?: { id: string; message: string };
}) {
  const classes = new Map<string, ColorClassRow>();
  const officials = new Map<string, OfficialColorRow>();

  for (const row of options?.seedClasses ?? []) classes.set(row.id, { ...row });
  for (const row of options?.seedOfficials ?? [])
    officials.set(row.id, { ...row });

  const fail = options?.failOnOfficialUpsert;

  const client = {
    colorClass: {
      upsert(args: UpsertArgs<ColorClassRow, Omit<ColorClassRow, "id">>) {
        const existing = classes.get(args.where.id);
        if (existing) {
          classes.set(args.where.id, { ...existing, ...args.update });
        } else {
          classes.set(args.where.id, { ...args.create });
        }
        return Promise.resolve(classes.get(args.where.id));
      },
    },
    officialColor: {
      upsert(
        args: UpsertArgs<OfficialColorRow, Omit<OfficialColorRow, "id">>,
      ) {
        if (fail && args.where.id === fail.id) {
          // Simulated persistence failure mid-run (Req 6.7). The mutation does
          // NOT apply — the throw propagates through $transaction, which rolls
          // back everything written so far.
          return Promise.reject(new Error(fail.message));
        }
        const existing = officials.get(args.where.id);
        if (existing) {
          officials.set(args.where.id, { ...existing, ...args.update });
        } else {
          officials.set(args.where.id, { ...args.create });
        }
        return Promise.resolve(officials.get(args.where.id));
      },
    },
    async $transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
      // Snapshot BEFORE running the callback so we can restore on failure.
      const classSnapshot = new Map(
        [...classes.entries()].map(([k, v]) => [k, { ...v }]),
      );
      const officialSnapshot = new Map(
        [...officials.entries()].map(([k, v]) => [k, { ...v }]),
      );
      try {
        return await cb(client);
      } catch (error) {
        // Roll back: restore both Maps to their pre-run snapshot.
        classes.clear();
        for (const [k, v] of classSnapshot) classes.set(k, v);
        officials.clear();
        for (const [k, v] of officialSnapshot) officials.set(k, v);
        throw error;
      }
    },
  };

  return {
    client: client as unknown as Parameters<typeof seedColorCatalog>[0],
    classes,
    officials,
  };
}

/** Snapshot a Map's rows into a plain, order-independent comparable object. */
function snapshot<V>(map: Map<string, V>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of map) out[k] = structuredClone(v);
  return out;
}

// --- Arbitraries -----------------------------------------------------------

const uuidArb = fc.uuid();
const codeArb = fc.string({ minLength: 1, maxLength: 12 });
const ageGroupArb = fc.constantFrom<"young" | "adult">("young", "adult");

/** A set of color classes with unique ids AND unique codes. */
const colorClassesArb: fc.Arbitrary<SeedColorClass[]> = fc
  .uniqueArray(
    fc.record({
      id: uuidArb,
      name: fc.string({ minLength: 1, maxLength: 20 }),
      code: codeArb,
    }),
    { minLength: 1, maxLength: 5, selector: (c) => c.code },
  )
  .map((arr) => {
    // Also dedupe ids so upsert keys stay distinct.
    const seen = new Set<string>();
    return arr.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  });

describe("seedColorCatalog property: atomic rollback on failure (Property 18)", () => {
  it("(a) rolls back leaving both tables pre-run when a classCode does not resolve, naming the offending color", async () => {
    await fc.assert(
      fc.asyncProperty(
        colorClassesArb.chain((classes) => {
          const validCodes = classes.map((c) => c.code);
          // A classCode guaranteed NOT to resolve to any seeded class.
          const unresolvedCode = fc
            .string({ minLength: 1, maxLength: 12 })
            .filter((code) => !validCodes.includes(code));
          return fc.record({
            classes: fc.constant(classes),
            // Some official colors that DO resolve (may be empty).
            resolvable: fc.array(
              fc.record({
                id: uuidArb,
                classCode: fc.constantFrom(...validCodes),
                ageGroup: ageGroupArb,
                code: codeArb,
                title: fc.string({ minLength: 1, maxLength: 20 }),
              }),
              { maxLength: 4 },
            ),
            offendingId: uuidArb,
            offendingCode: fc.string({ minLength: 1, maxLength: 12 }),
            unresolvedCode,
            // Where to place the offender among the resolvable ones.
            insertAt: fc.nat(),
          });
        }),
        async ({
          classes,
          resolvable,
          offendingId,
          offendingCode,
          unresolvedCode,
          insertAt,
        }) => {
          const offender: SeedOfficialColor = {
            id: offendingId,
            classCode: unresolvedCode,
            ageGroup: "young",
            code: offendingCode,
            title: "offending",
          };
          const officials: SeedOfficialColor[] = [...resolvable];
          const pos = officials.length === 0 ? 0 : insertAt % (officials.length + 1);
          officials.splice(pos, 0, offender);

          // Ensure official ids are unique so upsert keys are distinct.
          const seenIds = new Set<string>();
          const dedupedOfficials = officials.filter((o) => {
            if (seenIds.has(o.id)) return false;
            seenIds.add(o.id);
            return true;
          });
          // The offender must survive dedupe (it has a fresh uuid, but guard).
          if (!dedupedOfficials.some((o) => o.id === offender.id)) {
            dedupedOfficials.push(offender);
          }

          const { client, classes: classMap, officials: officialMap } =
            makeFakePrisma();

          // Pre-run state: both tables empty.
          const preClasses = snapshot(classMap);
          const preOfficials = snapshot(officialMap);

          const dataset: SeedDataset = {
            colorClasses: classes,
            officialColors: dedupedOfficials,
          };

          let thrown: unknown;
          try {
            await seedColorCatalog(client, dataset);
          } catch (error) {
            thrown = error;
          }

          // Aborted with a SeedError naming the offending color + reference.
          expect(thrown).toBeInstanceOf(SeedError);
          const message = (thrown as SeedError).message;
          expect(message).toContain(unresolvedCode);
          expect(message).toContain(offender.code);
          expect(message).toContain(offender.id);

          // Both tables restored to EXACTLY their pre-run state (Req 6.6).
          expect(snapshot(classMap)).toEqual(preClasses);
          expect(snapshot(officialMap)).toEqual(preOfficials);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("(b) rolls back to a pre-seeded baseline when a persistence op fails mid-run, propagating the failure", async () => {
    await fc.assert(
      fc.asyncProperty(
        colorClassesArb.chain((classes) => {
          const validCodes = classes.map((c) => c.code);
          return fc
            .uniqueArray(
              fc.record({
                id: uuidArb,
                classCode: fc.constantFrom(...validCodes),
                ageGroup: ageGroupArb,
                code: codeArb,
                title: fc.string({ minLength: 1, maxLength: 20 }),
              }),
              { minLength: 1, maxLength: 5, selector: (o) => o.id },
            )
            .chain((officials) =>
              fc.record({
                classes: fc.constant(classes),
                officials: fc.constant(officials),
                // Pick one official whose upsert will simulate a DB error.
                failIndex: fc.nat({ max: officials.length - 1 }),
                failMessage: fc.constantFrom(
                  "connection reset",
                  "deadlock detected",
                  "unique constraint violated",
                ),
              }),
            );
        }),
        async ({ classes, officials, failIndex, failMessage }) => {
          const failing = officials[failIndex]!;

          // Pre-seed a baseline so we assert restore to a NON-empty prior state.
          const baselineClass: ColorClassRow = {
            id: "baseline-class-id",
            name: "baseline",
            code: "__baseline__",
          };
          const baselineOfficial: OfficialColorRow = {
            id: "baseline-official-id",
            classId: "baseline-class-id",
            ageGroup: "adult",
            code: "__basebird__",
            title: "baseline official",
          };

          const { client, classes: classMap, officials: officialMap } =
            makeFakePrisma({
              seedClasses: [baselineClass],
              seedOfficials: [baselineOfficial],
              failOnOfficialUpsert: {
                id: failing.id,
                message: failMessage,
              },
            });

          const preClasses = snapshot(classMap);
          const preOfficials = snapshot(officialMap);

          const dataset: SeedDataset = {
            colorClasses: classes,
            officialColors: officials,
          };

          let thrown: unknown;
          try {
            await seedColorCatalog(client, dataset);
          } catch (error) {
            thrown = error;
          }

          // The simulated DB error propagated (Req 6.7).
          expect(thrown).toBeInstanceOf(Error);
          expect((thrown as Error).message).toBe(failMessage);

          // Both tables restored to EXACTLY the pre-run baseline (Req 6.7).
          expect(snapshot(classMap)).toEqual(preClasses);
          expect(snapshot(officialMap)).toEqual(preOfficials);
        },
      ),
      { numRuns: 100 },
    );
  });
});
