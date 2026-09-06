import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import fc from 'fast-check';
import { ForgotPasswordDto } from './forgot-password.dto';

/**
 * Property-based test for forgot-password input validation.
 *
 * Validates: Requirements 6.3
 *
 * Property 20 (Forgot-password input validation): for any forgot-password
 * request whose `email` is missing, empty, exceeds 254 chars, or is not in
 * `local-part@domain` format, validation reports at least one error. The
 * controller-facing effect (a 400 VALIDATION_ERROR response and no email being
 * dispatched) is enforced upstream by the global ValidationPipe + exception
 * filter, which reject the request before the controller/service runs — so no
 * mailer is ever invoked. Here we exercise the DTO constraints directly with
 * `plainToInstance` + `validateSync`, which is what that pipe drives.
 */

/** Runs the DTO validators against a raw request body. */
function validateBody(body: Record<string, unknown>) {
  const dto = plainToInstance(ForgotPasswordDto, body);
  return validateSync(dto, { forbidUnknownValues: false });
}

/**
 * Generates `email` values that must be rejected per Req 6.3:
 * - missing (`undefined`) or `null`
 * - empty string
 * - overlong strings (> 254 chars), including otherwise well-formed addresses
 * - malformed non-email strings (no `@`, no domain, spaces, etc.)
 */
function invalidEmailArbitrary(): fc.Arbitrary<unknown> {
  const missing = fc.constantFrom(undefined, null);

  const empty = fc.constant('');

  // A syntactically valid-looking address padded past the 254-char limit.
  const overlong = fc
    .integer({ min: 255, max: 400 })
    .map((total) => {
      const domain = '@example.com';
      const local = 'a'.repeat(Math.max(1, total - domain.length));
      return `${local}${domain}`;
    })
    .filter((s) => s.length > 254);

  // Malformed strings that are not `local-part@domain`.
  const malformed = fc.oneof(
    // no '@' at all
    fc.string({ minLength: 1, maxLength: 40 }).filter((s) => !s.includes('@')),
    // '@' present but missing local part or domain, or containing spaces
    fc.constantFrom(
      '@',
      '@domain.com',
      'local@',
      'local@@example.com',
      'plainaddress',
      'has space@example.com',
      'local@ domain.com',
      'local@domain',
      'a@b@c.com',
      'local@.com',
      'local@domain..com',
    ),
  );

  return fc.oneof(missing, empty, overlong, malformed);
}

describe('ForgotPasswordDto validation (Property 20)', () => {
  // Feature: auth, Property 20: Forgot-password input validation
  it('rejects missing/empty/overlong/malformed emails', () => {
    fc.assert(
      fc.property(invalidEmailArbitrary(), (email) => {
        const errors = validateBody({ email });
        expect(errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it('accepts a well-formed local-part@domain email within 254 chars (sanity)', () => {
    const errors = validateBody({ email: 'user@example.com' });
    expect(errors).toHaveLength(0);
  });
});
