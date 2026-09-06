import 'reflect-metadata';
import fc from 'fast-check';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RefreshDto } from './refresh.dto';

/**
 * Property-based test for `POST /auth/refresh` input validation.
 *
 * Validates: Requirements 3.5
 *
 * Property 12 (Refresh input validation): for any refresh request where
 * `refresh_token` is missing, null, empty, whitespace-only, or a non-string
 * value, the DTO fails validation (which the controller layer surfaces as a
 * 400 VALIDATION_ERROR, issuing no tokens). A non-empty, non-whitespace string
 * is the only accepted shape.
 */

/** Whitespace characters used to build whitespace-only inputs. */
const WHITESPACE_CHARS = [' ', '\t', '\n', '\r', '\f', '\v', '\u00a0'];

/** Runs class-validator against a raw (untrusted) payload for the DTO. */
function validatePayload(payload: unknown) {
  const dto = plainToInstance(RefreshDto, payload);
  return validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });
}

/**
 * Generates `refresh_token` values that must be rejected per Req 3.5: missing,
 * null, the empty string, whitespace-only strings, or non-string types.
 */
function invalidRefreshTokenArbitrary(): fc.Arbitrary<{ refresh_token?: unknown }> {
  const missing = fc.constant({} as { refresh_token?: unknown });
  const nullValue = fc.constant({ refresh_token: null });
  const empty = fc.constant({ refresh_token: '' });
  const whitespaceOnly = fc
    .array(fc.constantFrom(...WHITESPACE_CHARS), { minLength: 1, maxLength: 8 })
    .map((chars) => ({ refresh_token: chars.join('') }));
  const nonString = fc
    .oneof(
      fc.integer(),
      fc.double(),
      fc.boolean(),
      fc.object(),
      fc.array(fc.string()),
    )
    .map((refresh_token) => ({ refresh_token }));

  return fc.oneof(missing, nullValue, empty, whitespaceOnly, nonString);
}

/**
 * Generates the only accepted shape: a string containing at least one
 * non-whitespace character.
 */
function validRefreshTokenArbitrary(): fc.Arbitrary<{ refresh_token: string }> {
  return fc
    .string({ minLength: 1, maxLength: 128 })
    // Must contain at least one non-whitespace character (the @Matches(/\S/) rule).
    .filter((s) => /\S/.test(s))
    .map((refresh_token) => ({ refresh_token }));
}

describe('RefreshDto (refresh input validation)', () => {
  // Feature: auth, Property 12: Refresh input validation
  it('rejects missing/null/empty/whitespace-only/non-string tokens and accepts non-blank strings', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          invalidRefreshTokenArbitrary().map((payload) => ({
            payload,
            valid: false as const,
          })),
          validRefreshTokenArbitrary().map((payload) => ({
            payload,
            valid: true as const,
          })),
        ),
        ({ payload, valid }) => {
          const errors = validatePayload(payload);

          if (valid) {
            expect(errors.length).toBe(0);
          } else {
            expect(errors.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
