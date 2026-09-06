import 'reflect-metadata';
import fc from 'fast-check';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { VerifyEmailDto } from './verify-email.dto';

/**
 * Property-based test for `POST /auth/verify-email` input validation.
 *
 * Validates: Requirements 5.3
 *
 * Property 17 (Verify-email input validation): for any verify-email request
 * whose `token` is missing, null, non-string, empty, or exceeds 512 chars, the
 * DTO fails validation (which the controller layer surfaces as a
 * 400 VALIDATION_ERROR). A string of length 1..512 is the only accepted shape.
 */

/** Runs class-validator against a raw (untrusted) payload for the DTO. */
function validatePayload(payload: unknown) {
  const dto = plainToInstance(VerifyEmailDto, payload);
  return validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });
}

/**
 * Generates `token` values that must be rejected per Req 5.3: missing,
 * null, non-string types, the empty string, or strings longer than 512 chars.
 */
function invalidTokenArbitrary(): fc.Arbitrary<{ token?: unknown }> {
  const missing = fc.constant({} as { token?: unknown });
  const nullValue = fc.constant({ token: null });
  const nonString = fc
    .oneof(
      fc.integer(),
      fc.double(),
      fc.boolean(),
      fc.object(),
      fc.array(fc.string()),
    )
    .map((token) => ({ token }));
  const empty = fc.constant({ token: '' });
  const tooLong = fc
    .string({
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
      minLength: 513,
      maxLength: 1024,
    })
    .map((token) => ({ token }));

  return fc.oneof(missing, nullValue, nonString, empty, tooLong);
}

/**
 * Generates the only accepted shape: a string of length 1..512. Restricted to
 * single-UTF-16-unit characters so the generated code-point count matches
 * `String.prototype.length` (what `@Length` measures).
 */
function validTokenArbitrary(): fc.Arbitrary<{ token: string }> {
  return fc
    .string({
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
      minLength: 1,
      maxLength: 512,
    })
    .map((token) => ({ token }));
}

describe('VerifyEmailDto (verify-email input validation)', () => {
  // Feature: auth, Property 17: Verify-email input validation
  it('rejects missing/null/non-string/empty/over-512 tokens and accepts 1..512-char strings', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          invalidTokenArbitrary().map((payload) => ({
            payload,
            valid: false as const,
          })),
          validTokenArbitrary().map((payload) => ({
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
