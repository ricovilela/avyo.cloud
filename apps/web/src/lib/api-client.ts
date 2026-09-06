// Centralized API client for the Avyo web app.
//
// Per `conventions-web`: all API consumption goes through this centralized
// client. It reads its base URL from `NEXT_PUBLIC_API_URL`, sets JSON headers,
// optionally injects an `Authorization: Bearer <token>`, and parses/throws the
// standard `Error_Envelope` from `@avyo/types` on non-ok responses.
//
// Auth refresh/redirect flows are intentionally out of scope here (later specs).
// A simple token param/getter is enough for the foundation.

import type { Error_Body, Error_Envelope } from "@avyo/types";

/** Resolves the API base URL from the public env var, trimming any trailing slash. */
function getBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not defined. Set it in your environment (see .env.example).",
    );
  }
  return baseUrl.replace(/\/+$/, "");
}

/** A bearer token, or a getter that returns one (sync or async). */
export type TokenProvider =
  | string
  | null
  | undefined
  | (() => string | null | undefined | Promise<string | null | undefined>);

/** Options accepted by {@link apiFetch}, extending the standard `RequestInit`. */
export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** Request body. Plain objects are JSON-serialized automatically. */
  body?: unknown;
  /** Bearer token or a (possibly async) getter used for the `Authorization` header. */
  token?: TokenProvider;
}

/**
 * Error thrown when the API responds with a non-ok status. Carries the parsed
 * standard `Error_Envelope` body when available, plus the HTTP status.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Error_Body["details"];

  constructor(status: number, body: Error_Envelope["error"]) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

async function resolveToken(token: TokenProvider): Promise<string | null | undefined> {
  return typeof token === "function" ? token() : token;
}

function isJsonResponse(response: Response): boolean {
  return response.headers.get("content-type")?.includes("application/json") ?? false;
}

/**
 * Perform a fetch against the API base URL.
 *
 * - Prefixes `path` with `NEXT_PUBLIC_API_URL`.
 * - Sets `Content-Type`/`Accept: application/json` (a provided body object is
 *   JSON-serialized).
 * - Injects `Authorization: Bearer <token>` when a token is available.
 * - On a non-ok response, parses the standard `Error_Envelope` and throws an
 *   {@link ApiError}.
 * - On success, returns the parsed JSON body typed as `T` (or `undefined` for
 *   empty responses).
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { body, token, headers, ...init } = options;

  const requestHeaders = new Headers(headers);
  requestHeaders.set("Accept", "application/json");

  let serializedBody: RequestInit["body"];
  if (body !== undefined && body !== null) {
    if (typeof body === "string" || body instanceof FormData || body instanceof Blob) {
      serializedBody = body;
    } else {
      requestHeaders.set("Content-Type", "application/json");
      serializedBody = JSON.stringify(body);
    }
  }

  const bearer = await resolveToken(token);
  if (bearer) {
    requestHeaders.set("Authorization", `Bearer ${bearer}`);
  }

  const url = `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...init,
    headers: requestHeaders,
    body: serializedBody,
  });

  if (!response.ok) {
    let errorBody: Error_Envelope["error"] = {
      code: `http_${response.status}`,
      message: response.statusText || "Request failed",
    };
    if (isJsonResponse(response)) {
      try {
        const parsed = (await response.json()) as Partial<Error_Envelope>;
        if (parsed?.error) {
          errorBody = parsed.error;
        }
      } catch {
        // Keep the fallback error body if the payload is not valid JSON.
      }
    }
    throw new ApiError(response.status, errorBody);
  }

  if (response.status === 204 || !isJsonResponse(response)) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/** Convenience client object exposing verb-specific helpers over {@link apiFetch}. */
export const apiClient = {
  get: <T = unknown>(path: string, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: "GET" }),
  post: <T = unknown>(path: string, body?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: "POST", body }),
  put: <T = unknown>(path: string, body?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: "PUT", body }),
  patch: <T = unknown>(path: string, body?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: "PATCH", body }),
  delete: <T = unknown>(path: string, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: "DELETE" }),
};
