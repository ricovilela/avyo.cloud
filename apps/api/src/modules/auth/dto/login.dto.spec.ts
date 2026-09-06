import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import fc from 'fast-check';

import { LoginDto } from './login.dto';

// Feature: auth, Property 7: Login input validation
//
// For any login request missing `email`, `password`, or `device`, or whose
// `device` omits or empties any of `user_agent`/`os`/`browser`, validation
// fails (the endpoint maps such failures to 400 VALIDATION_ERROR).
//
// **Validates: Requirements 2.7**

interface ValidBase {
  email: string;
  password: string;
  captcha0: string;
  captcha1: string;
  device: { user_agent: string; os: string; browser: string };
}

function makeValidBase(): ValidBase {
  return {
    email: 'user@example.com',
    password: 'correct horse battery staple',
    captcha0: 'c0',
    captcha1: 'c1',
    device: { user_agent: 'Mozilla/5.0', os: 'Linux', browser: 'Firefox' },
  };
}

function validate(input: unknown): number {
  const instance = plainToInstance(LoginDto, input);
  return validateSync(instance, { whitelist: false }).length;
}

describe('LoginDto validation (Property 7)', () => {
  it('accepts a well-formed login request (sanity check)', () => {
    expect(validate(makeValidBase())).toBe(0);
  });

  it('rejects any request missing a top-level field or with a broken device', () => {
    type Mutation =
      | { kind: 'remove_top'; field: 'email' | 'password' | 'device' }
      | { kind: 'remove_device_field'; field: 'user_agent' | 'os' | 'browser' }
      | { kind: 'empty_device_field'; field: 'user_agent' | 'os' | 'browser' };

    const deviceField = fc.constantFrom<'user_agent' | 'os' | 'browser'>(
      'user_agent',
      'os',
      'browser',
    );

    const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
      fc
        .constantFrom<'email' | 'password' | 'device'>('email', 'password', 'device')
        .map((field) => ({ kind: 'remove_top', field }) as const),
      deviceField.map((field) => ({ kind: 'remove_device_field', field }) as const),
      deviceField.map((field) => ({ kind: 'empty_device_field', field }) as const),
    );

    fc.assert(
      fc.property(mutationArb, (mutation) => {
        const input = makeValidBase();

        switch (mutation.kind) {
          case 'remove_top':
            delete (input as unknown as Record<string, unknown>)[mutation.field];
            break;
          case 'remove_device_field':
            delete (input.device as unknown as Record<string, unknown>)[mutation.field];
            break;
          case 'empty_device_field':
            input.device[mutation.field] = '';
            break;
        }

        // Every mutation yields a truly-invalid request, so validation must
        // report at least one error.
        expect(validate(input)).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });
});
