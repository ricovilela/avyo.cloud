"use strict";
/**
 * Typed seed dataset for the GLOBAL/official color catalogs.
 *
 * This module is the single source of the concrete color data consumed by the
 * Prisma seed script (`apps/api/prisma/seed.ts`). The seed logic contains NO
 * color data itself — it reads the two typed arrays below — so once the real
 * dataset lands here, the seed runs unchanged.
 *
 * OPEN DECISION (see requirements.md "Open Decisions" and mvp-project.md §11.2):
 * the origin and exact contents of the official colors and color classes are
 * not yet fixed. Until then these arrays ship empty so the seed compiles and
 * runs to completion, producing an empty (but valid) catalog.
 *
 * Authoring rules:
 * - `id` fields are STABLE version-4 UUIDs authored here (Req 6.4). They are
 *   the upsert keys, so they must never change once a record ships — changing
 *   an `id` would create a duplicate instead of converging (Req 6.3).
 * - `SeedOfficialColor.classCode` references a `SeedColorClass.code`; the seed
 *   resolves it to the created class `id` (Req 6.2, 6.6).
 * - `ageGroup` is narrowed to exactly `'young' | 'adult'` (Req 6.5).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.officialColors = exports.colorClasses = void 0;
/**
 * The defined set of color classes. Contents TBD (open decision) — empty for
 * now so the seed produces an empty, valid catalog.
 */
exports.colorClasses = [];
/**
 * The defined set of official colors. Contents TBD (open decision) — empty for
 * now so the seed produces an empty, valid catalog.
 */
exports.officialColors = [];
//# sourceMappingURL=color-catalog.js.map