"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeedError = void 0;
exports.seedColorCatalog = seedColorCatalog;
/**
 * Prisma seed — GLOBAL/official color catalogs.
 *
 * Populates the two global catalogs (`color_class`, `official_color`) from the
 * typed dataset module `prisma/seed-data/color-catalog.ts`. This script holds
 * NO color data itself — it reads the two typed arrays — so it runs unchanged
 * once the real dataset lands there.
 *
 * Guarantees (Requirement 6):
 * - Idempotent + convergent: records are upserted on their stable authored v4
 *   UUID (`id`), so re-running converges to exactly the defined set with no
 *   duplicates and no primary-key changes (Req 6.1, 6.3, 6.4).
 * - age_group validated BEFORE any write: an invalid `ageGroup` rejects the
 *   whole run before a transaction opens (Req 6.5).
 * - Transactional: all writes run inside a single interactive
 *   `prisma.$transaction`, so an unresolved class reference (Req 6.6) or any DB
 *   error (Req 6.7) rolls the whole run back, leaving both tables exactly as
 *   they were before the run began.
 *
 * The core logic is exported as `seedColorCatalog` so tests can drive it with a
 * Prisma client and custom datasets; `main()` is a thin wrapper that runs it
 * against the real dataset and handles process exit.
 */
const client_1 = require("@prisma/client");
const color_catalog_1 = require("./seed-data/color-catalog");
/** The two valid `age_group` values (Req 6.5). */
const AGE_GROUPS = ["young", "adult"];
function isValidAgeGroup(value) {
    return value === "young" || value === "adult";
}
/**
 * Error raised when the seed cannot proceed with the given dataset. Carries a
 * clear, human-readable message naming the offending record and reference.
 */
class SeedError extends Error {
    constructor(message) {
        super(message);
        this.name = "SeedError";
    }
}
exports.SeedError = SeedError;
/**
 * Seed (upsert) the global color catalogs idempotently and transactionally.
 *
 * Validation of every `officialColor.ageGroup` happens BEFORE the transaction
 * opens (Req 6.5): a bad dataset never opens a write. Inside a single
 * interactive `$transaction` the process upserts all color classes on their
 * stable `id`, builds a `code → id` map from them, resolves each official
 * color's `classCode` to a real `class_id`, then upserts all official colors on
 * their stable `id`. An unresolved `classCode` (Req 6.6) or any DB error
 * (Req 6.7) throws inside the callback, so the transaction rolls back and both
 * tables are left in their pre-run state.
 *
 * @throws {SeedError} if any `officialColor.ageGroup` is not `young`/`adult`,
 *   or if any `officialColor.classCode` does not resolve to a seeded class.
 */
async function seedColorCatalog(prisma, dataset) {
    const { colorClasses, officialColors } = dataset;
    // --- Pre-transaction validation: age_group ∈ {young, adult} (Req 6.5). ---
    // Runs BEFORE any write so an invalid dataset never opens a transaction.
    for (const color of officialColors) {
        if (!isValidAgeGroup(color.ageGroup)) {
            throw new SeedError(`Invalid age_group "${String(color.ageGroup)}" for official color ` +
                `"${color.code}" (id ${color.id}); expected "young" or "adult".`);
        }
    }
    return prisma.$transaction(async (tx) => {
        // 1. Upsert every color class keyed by its stable authored id (Req 6.3).
        for (const colorClass of colorClasses) {
            await tx.colorClass.upsert({
                where: { id: colorClass.id },
                create: {
                    id: colorClass.id,
                    name: colorClass.name,
                    code: colorClass.code,
                },
                update: {
                    name: colorClass.name,
                    code: colorClass.code,
                },
            });
        }
        // 2. Build the in-memory code → id map from the seeded classes (Req 6.2).
        const classIdByCode = new Map();
        for (const colorClass of colorClasses) {
            classIdByCode.set(colorClass.code, colorClass.id);
        }
        // 3. Upsert every official color keyed by its stable id, resolving its
        //    classCode to a real class_id. Unresolved reference → abort + roll back
        //    (Req 6.6).
        for (const color of officialColors) {
            const classId = classIdByCode.get(color.classCode);
            if (classId === undefined) {
                throw new SeedError(`Unresolved classCode "${color.classCode}" for official color ` +
                    `"${color.code}" (id ${color.id}); no seeded color class has ` +
                    `that code.`);
            }
            await tx.officialColor.upsert({
                where: { id: color.id },
                create: {
                    id: color.id,
                    classId,
                    ageGroup: color.ageGroup,
                    code: color.code,
                    title: color.title,
                },
                update: {
                    classId,
                    ageGroup: color.ageGroup,
                    code: color.code,
                    title: color.title,
                },
            });
        }
        return {
            colorClassCount: colorClasses.length,
            officialColorCount: officialColors.length,
        };
    });
}
/**
 * Thin entrypoint: run the seed against the real dataset and handle exit. Any
 * DB error surfaces from `$transaction` after rolling back (Req 6.7).
 */
async function main() {
    const prisma = new client_1.PrismaClient();
    try {
        const result = await seedColorCatalog(prisma, {
            colorClasses: color_catalog_1.colorClasses,
            officialColors: color_catalog_1.officialColors,
        });
        console.log(`Seed complete — ${result.colorClassCount} color class(es), ` +
            `${result.officialColorCount} official color(s).`);
    }
    finally {
        await prisma.$disconnect();
    }
}
// Only run when executed directly (e.g. `prisma db seed`), not when imported by
// tests.
if (require.main === module) {
    main()
        .then(() => {
        process.exit(0);
    })
        .catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
//# sourceMappingURL=seed.js.map