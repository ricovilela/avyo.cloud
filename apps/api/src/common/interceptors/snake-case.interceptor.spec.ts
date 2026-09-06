import { lastValueFrom, of } from 'rxjs';
import fc from 'fast-check';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import {
  SnakeCaseInterceptor,
  convertKeysToSnakeCase,
} from './snake-case.interceptor';

/**
 * Property-based tests for the snake_case serialization interceptor.
 *
 * Validates: Requirements 12.3
 *
 * The core guarantee is that every field name the system emits in a body —
 * including nested object keys and keys of objects nested inside arrays — is
 * `snake_case`, regardless of the casing a controller happens to return.
 */

/** Matches a canonical snake_case identifier: lowercase words separated by `_`. */
const SNAKE_CASE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/**
 * Recursively collects every object key found in a value, descending into
 * nested plain objects and into objects contained in arrays.
 */
function collectKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, acc);
    }
    return acc;
  }
  if (isPlainObject(value)) {
    for (const [key, val] of Object.entries(value)) {
      acc.push(key);
      collectKeys(val, acc);
    }
  }
  return acc;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (value instanceof Date) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * Generates keys in a variety of casings so the interceptor has to normalize
 * camelCase, PascalCase, kebab-case, spaced, SCREAMING, mixed and already
 * snake_case names.
 */
function keyArbitrary(): fc.Arbitrary<string> {
  const word = fc
    .string({ minLength: 1, maxLength: 6 })
    .map((s) => s.replace(/[^a-zA-Z]/g, ''))
    .filter((s) => s.length > 0);
  const words = fc.array(word, { minLength: 1, maxLength: 4 });

  return words.chain((parts) =>
    fc.constantFrom<(w: string[]) => string>(
      // camelCase
      (w) =>
        w
          .map((p, i) =>
            i === 0
              ? p.toLowerCase()
              : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
          )
          .join(''),
      // PascalCase
      (w) =>
        w
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
          .join(''),
      // kebab-case
      (w) => w.map((p) => p.toLowerCase()).join('-'),
      // spaced
      (w) => w.map((p) => p.toLowerCase()).join(' '),
      // SCREAMING_SNAKE
      (w) => w.map((p) => p.toUpperCase()).join('_'),
      // already snake_case
      (w) => w.map((p) => p.toLowerCase()).join('_'),
      // mixed camel + acronym run
      (w) => w.join('') + 'ID',
    ).map((format) => format(parts)),
  );
}

/**
 * Builds arbitrary nested JSON-like structures (objects, arrays, and leaf
 * values including Date instances) with arbitrarily-cased keys.
 */
function bodyArbitrary(): fc.Arbitrary<unknown> {
  const leaf: fc.Arbitrary<unknown> = fc.oneof(
    fc.string(),
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.boolean(),
    fc.constant(null),
    fc.date({ noInvalidDate: true }),
  );

  return fc.letrec<{ node: unknown }>((tie) => ({
    node: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      leaf,
      fc.array(tie('node'), { maxLength: 4 }),
      fc.dictionary(keyArbitrary(), tie('node'), { maxKeys: 5 }),
    ),
  })).node;
}

function createCallHandler(body: unknown): CallHandler {
  return { handle: () => of(body) };
}

const executionContext = {} as ExecutionContext;

describe('SnakeCaseInterceptor', () => {
  // Feature: auth, Property 32: All body field names are snake_case
  it('produces bodies whose every (nested) field name is snake_case', async () => {
    const interceptor = new SnakeCaseInterceptor();

    await fc.assert(
      fc.asyncProperty(bodyArbitrary(), async (body) => {
        const result = await lastValueFrom(
          interceptor.intercept(executionContext, createCallHandler(body)),
        );

        for (const key of collectKeys(result)) {
          expect(key).toMatch(SNAKE_CASE);
          expect(key).not.toMatch(/[A-Z]/);
          expect(key).not.toMatch(/[-\s]/);
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: auth, Property 32: All body field names are snake_case
  it('preserves values: arrays stay arrays, primitives and Dates unchanged', () => {
    fc.assert(
      fc.property(bodyArbitrary(), (body) => {
        const result = convertKeysToSnakeCase(body);

        const check = (input: unknown, output: unknown): void => {
          if (Array.isArray(input)) {
            expect(Array.isArray(output)).toBe(true);
            const outArr = output as unknown[];
            expect(outArr).toHaveLength(input.length);
            input.forEach((item, i) => check(item, outArr[i]));
            return;
          }
          if (input instanceof Date) {
            expect(output).toBeInstanceOf(Date);
            expect((output as Date).getTime()).toBe(input.getTime());
            return;
          }
          if (isPlainObject(input)) {
            expect(isPlainObject(output)).toBe(true);
            const outObj = output as Record<string, unknown>;
            const inKeys = Object.keys(input);
            // Distinct source keys can legitimately collapse to the same
            // snake_case key (e.g. `userId` and `user-id`), so the output may
            // have fewer keys — never more.
            expect(Object.keys(outObj).length).toBeLessThanOrEqual(
              inKeys.length,
            );
            // When no collision occurred, values are preserved positionally.
            if (Object.keys(outObj).length === inKeys.length) {
              const inValues = Object.values(input);
              const outValues = Object.values(outObj);
              inValues.forEach((v, i) => check(v, outValues[i]));
            }
            return;
          }
          // primitives / null are unchanged
          expect(output).toEqual(input);
        };

        check(body, result);
      }),
      { numRuns: 200 },
    );
  });
});
