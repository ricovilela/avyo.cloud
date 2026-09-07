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

/** A global color class to seed (`color_class` table). No `user_id`. */
export interface SeedColorClass {
  /** Stable authored v4 UUID — the upsert primary key (Req 6.4). */
  id: string;
  name: string;
  code: string;
}

/** A global official color to seed (`official_color` table). No `user_id`. */
export interface SeedOfficialColor {
  /** Stable authored v4 UUID — the upsert primary key (Req 6.4). */
  id: string;
  /** Resolves to a `SeedColorClass.code`; seed maps it to the class `id`. */
  classCode: string;
  ageGroup: "young" | "adult";
  code: string;
  title: string;
}

/**
 * The defined set of color classes. Contents TBD (open decision) — empty for
 * now so the seed produces an empty, valid catalog.
 */
export const colorClasses: SeedColorClass[] = [];

/**
 * The defined set of official colors. Contents TBD (open decision) — empty for
 * now so the seed produces an empty, valid catalog.
 */
export const officialColors: SeedOfficialColor[] = [];
