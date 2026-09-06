import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import fc from 'fast-check';
import { ResetPasswordDto } from './reset-password.dto';

/**
 * Property-based test for `POST /auth/reset-password` input validation.
 *
 * Validates: Requirements 7.5
 *
 * Property 23 (Reset-password input validation): for any reset-password request
 * missing `token`, missing `password`, or with a `password` shorter than 8 or
 * longer than 128 chars, validation fails (yielding a 400 VALIDATION_ERROR via
 * the global ValidationPipe/exception filter). The "password_hash unchanged"
 * clause is enforced by the ValidationPipe rejecting the request before the
 * controller/service runs, so no persistence layer is reached and the stored
 * `password_hash` is never mutated. This test asserts the validation gate that
 * guarantees that behaviour.
 */

/** Runs class-validator over a raw payload the way the ValidationPipe does. */
function validate(payload: unknown): number {
  const dto = plainToInstance(ResetPasswordDto, payload);
  return validateSync(dto, {
    whitelist: false,
    forbidNonWhitelisted: false,
  }).length;
}

/** A valid token: non-empty string, 1..512 chars. */
function validTokenArbitrary(): fc.Arbitrary<string> {
  return fc.string({ minLength: 1, maxLength: 512 });
}

/** A valid password: string, 8..128 chars. */
function validPasswordArbitrary(): fc.Arbitrary<string> {
  return fc.string({ minLength: 8, maxLength: 128 });
}

/**
 * Generates invalid reset-password payloads that must fail validation:
 * - missing/null/non-string token
 * - missing/null/non-string password
 * - password too short (< 8 chars)
 * - password too long (> 128 chars)
 */
function invalidPayloadArbitrary(): fc.Arbitrary<Record<string, unknown>> {
  const nonStringValue = fc.oneof(
    fc.constant(undefined),
    fc.constant(null),
    fc.integer(),
    fc.boolean(),
    fc.record({}),
    fc.array(fc.string()),
  );

  const shortPassword = fc.string({ minLength: 0, maxLength: 7 });
  const longPassword = fc
    .string({ minLength: 129, maxLength: 200 })
    .filter((s) => s.length >= 129);

  const missingToken = validPasswordArbitrary().map((password) => ({
    password,
  }));
  const badToken = fc
    .tuple(nonStringValue, validPasswordArbitrary())
    .map(([token, password]) => ({ token, password }));

  const missingPassword = validTokenArbitrary().map((token) => ({ token }));
  const badPassword = fc
    .tuple(validTokenArbitrary(), nonStringValue)
    .map(([token, password]) => ({ token, password }));

  const tooShortPassword = fc
    .tuple(validTokenArbitrary(), shortPassword)
    .map(([token, password]) => ({ token, password }));
  const tooLongPassword = fc
    .tuple(validTokenArbitrary(), longPassword)
    .map(([token, password]) => ({ token, password }));

  return fc.oneof(
    missingToken,
    badToken,
    missingPassword,
    badPassword,
    tooShortPassword,
    tooLongPassword,
  );
}

describe('ResetPasswordDto (reset-password input validation)', () => {
  // Feature: auth, Property 23: Reset-password input validation
  it('rejects invalid payloads and accepts valid token + password', () => {
    fc.assert(
      fc.property(invalidPayloadArbitrary(), (payload) => {
        // Any missing/malformed field must produce at least one error, which
        // the ValidationPipe surfaces as 400 VALIDATION_ERROR before the
        // controller runs — so password_hash is never touched.
        expect(validate(payload)).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );

    // Sanity: a well-formed request passes validation.
    fc.assert(
      fc.property(
        validTokenArbitrary(),
        validPasswordArbitrary(),
        (token, password) => {
          expect(validate({ token, password })).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
