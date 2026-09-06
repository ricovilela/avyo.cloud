// @avyo/types — shared contract entry point.
//
// Single source of truth for the web ↔ api contract. Consumers import
// everything from the package root (no subpath imports required).
// All contract fields use snake_case to match the API body contract
// in `mvp-project.md` §6.

// --- Enums (real runtime values) -------------------------------------------

/** Bird sex. Exactly two members, per `mvp-project.md` §5.2. */
export enum sex {
  M = "M",
  F = "F",
}

/** Bird age group. Exactly two members, per `mvp-project.md` §5.2. */
export enum age_group {
  young = "young",
  adult = "adult",
}

// --- Pagination envelope ----------------------------------------------------

/** Pagination navigation links. `prev`/`next` are nullable. */
export interface Pagination_Links {
  first: string;
  last: string;
  prev: string | null;
  next: string | null;
}

/**
 * Pagination metadata. `from`/`to` are nullable; `current_page`,
 * `last_page`, `per_page`, and `total` are non-negative integers.
 */
export interface Pagination_Meta {
  current_page: number;
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
}

/**
 * Standard paginated response envelope. `data` is generic so each
 * endpoint keys it by entity (`{ "<entity>": [...] }`) per §6.
 */
export interface Pagination_Envelope<T> {
  data: T;
  links: Pagination_Links;
  meta: Pagination_Meta;
}

// --- Error envelope ---------------------------------------------------------

/** A single field-level error entry. */
export interface Error_Detail {
  field: string;
  message: string;
}

/** Error body: a string `code`, a string `message`, and optional `details`. */
export interface Error_Body {
  code: string;
  message: string;
  details?: Error_Detail[];
}

/** Standard error response envelope. */
export interface Error_Envelope {
  error: Error_Body;
}
