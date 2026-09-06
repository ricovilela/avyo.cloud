import fc from 'fast-check';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { SignupDto } from './signup.dto';

/**
 * Property test for signup input validation (Req 1.6).
 *
 * We exercise the DTO validation layer exactly as the global `ValidationPipe`
 * does: `plainToInstance(SignupDto, input)` followed by `validateSync`. When
 * the pipe reports errors it rejects the request with `400 VALIDATION_ERROR`
 * *before* the controller runs, so "persists no user" is guaranteed by
 * construction — no user-creation code is ever reached. At the DTO level the
 * observable property is therefore: an invalid input yields validation errors.
 */

/** A valid, RFC-5322 email whose length stays inside the DTO's 3–254 bounds. */
const validEmailArb = fc
  .emailAddress()
  .filter((email) => email.length >= 3 && email.length <= 254);

/** A base signup payload that satisfies every DTO constraint. */
const validBaseArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 255 }),
  email: validEmailArb,
  password: fc.string({ minLength: 8, maxLength: 128 }),
  captcha0: fc.string({ minLength: 1, maxLength: 32 }),
  captcha1: fc.string({ minLength: 1, maxLength: 32 }),
});

/** name outside 1–255 chars: empty, or longer than 255. */
const invalidNameArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 256, maxLength: 400 }),
);

/** email that is absent, empty, exceeds 254 chars, or is not RFC 5322 format. */
const invalidEmailArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  // Non-RFC-5322 shapes (no `@`, missing local/domain, whitespace, etc).
  fc.constantFrom('plainaddress', 'no-at-sign', '@no-local.com', 'user@', 'a b@c.com', 'user@@example.com'),
  // Valid-shaped local part but overall length > 254.
  fc.string({ minLength: 250, maxLength: 300 }).map((s) => `${s}@example.com`),
);

/** password outside 8–128 chars: too short, or too long. */
const invalidPasswordArb = fc.oneof(
  fc.string({ minLength: 0, maxLength: 7 }),
  fc.string({ minLength: 129, maxLength: 200 }),
);

type Field = 'name' | 'email' | 'password';

describe('SignupDto validation (Req 1.6)', () => {
  // Sanity anchor: the base payloads we mutate from are genuinely valid.
  it('accepts a fully valid signup payload (no errors)', () => {
    fc.assert(
      fc.property(validBaseArb, (base) => {
        const instance = plainToInstance(SignupDto, base);
        const errors = validateSync(instance, { whitelist: false });
        expect(errors.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: auth, Property 4: Signup input validation
  // Validates: Requirements 1.6
  it('rejects any payload where a single field is mutated to an invalid value', () => {
    const brokenPayloadArb = validBaseArb.chain((base) =>
      fc
        .constantFrom<Field>('name', 'email', 'password')
        .chain((field) => {
          const invalidValueArb =
            field === 'name'
              ? invalidNameArb
              : field === 'email'
                ? invalidEmailArb
                : invalidPasswordArb;

          return invalidValueArb.map((invalidValue) => {
            const payload: Record<string, unknown> = { ...base };
            if (field === 'email' && invalidValue === undefined) {
              delete payload.email;
            } else {
              payload[field] = invalidValue;
            }
            return payload;
          });
        }),
    );

    fc.assert(
      fc.property(brokenPayloadArb, (payload) => {
        const instance = plainToInstance(SignupDto, payload);
        const errors = validateSync(instance, { whitelist: false });
        expect(errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});
