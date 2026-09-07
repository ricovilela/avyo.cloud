import type { Pagination_Envelope } from '@avyo/types';

/**
 * Wraps a row array in a single-page {@link Pagination_Envelope} (Req 7.5).
 *
 * Because the global catalogs are small and stable, the whole result set is
 * reported on a single page: `per_page = total`, `current_page = 1`,
 * `last_page = 1`. `data` holds exactly one entity key (`key`) whose value is
 * the rows array. `from`/`to` are `null` when the set is empty (Req 1.3),
 * otherwise `1`/`total`. `links` carries empty `first`/`last` (populated by the
 * API URL context) with `prev`/`next` null.
 *
 * @param key  the single entity key under `data` (e.g. `color_class`).
 * @param rows the already-filtered, already-ordered records.
 */
export function buildEnvelope<K extends string, T>(
  key: K,
  rows: T[],
): Pagination_Envelope<Record<K, T[]>> {
  const total = rows.length;
  return {
    data: { [key]: rows } as Record<K, T[]>,
    links: { first: '', last: '', prev: null, next: null },
    meta: {
      current_page: 1,
      from: total === 0 ? null : 1,
      last_page: 1,
      per_page: total,
      to: total === 0 ? null : total,
      total,
    },
  };
}
